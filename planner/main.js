/**
 * GEMINI MASTER CONTROL SCRIPT
 * Features: Compact Scaling (1.2), Fuzzy Deduplication, 12-Hour Clock, Live Time Marker
 */

const CONFIG = {
    scheduleUrl: 'https://raw.githubusercontent.com/scottscalici/loquesea/main/planner/schedule.json',
    calendarUrl: 'https://raw.githubusercontent.com/scottscalici/imagenes/main/planes/calendario.json',
    coziUrl: 'https://corsproxy.io/?' + encodeURIComponent('https://rest.cozi.com/api/ext/1103/f9f7020d-05c9-4720-b813-2155b4485be7/icalendar/feed/feed.ics'),
    pixelsPerMinute: 1.2 // Compact view: 1 hour = 72px
};

async function buildMyDay() {
    try {
        const [scheduleRes, calendarRes, coziRes] = await Promise.all([
            fetch(CONFIG.scheduleUrl),
            fetch(CONFIG.calendarUrl),
            fetch(CONFIG.coziUrl)
        ]);

        const schedule = await scheduleRes.json();
        const calendar = await calendarRes.json();
        const coziText = await coziRes.text();

        // 1. DATE LOGIC (Today: 2026-01-14)
        const now = new Date();
        const todayStr = now.toISOString().split('T')[0]; 
        const todayMatch = todayStr.replace(/-/g, ''); 
        
        // 2. DAY TYPE TRANSLATION
        const rawValue = schedule.overrides[todayStr] || calendar[todayStr] || "A";
        const dayTypeMap = { "A": "A_Day", "B": "B_Day", "PD": "PD_Day", "Work": "PD_Day" };
        const dayTypeKey = dayTypeMap[rawValue] || rawValue;
        
        document.getElementById('day-header').innerText = `${todayStr} (${dayTypeKey})`;
        const timeline = document.getElementById('timeline');
        timeline.innerHTML = '';

        // 3. MORNING LAUNCH (Purple)
        if (schedule.hard_stops?.school_dropoff) {
            const dropOff = schedule.hard_stops.school_dropoff;
            const routine = schedule.definitions.routines[dropOff.trigger_routine];
            const wheelsUp = subtractMinutes(dropOff.time, dropOff.commute_minutes);
            const wakeUp = subtractMinutes(wheelsUp, routine.duration);
            renderBrick(wakeUp, wheelsUp, routine.label, "purple", routine.subtasks);
        }

        // 4. FOUNDATION BRICKS (Blue/Grey)
        const dayBricks = schedule.days[dayTypeKey] || [];
        dayBricks.forEach(brick => {
            const temp = schedule.definitions.brick_templates[brick.template] || {color: "grey"};
            const end = brick.end || addMinutes(brick.start, brick.duration);
            renderBrick(brick.start, end, brick.label, temp.color, []);
        });

        // 5. COZI BRICKS (Orange - Smart Deduplication)
        const vevents = coziText.split("BEGIN:VEVENT");
        let takenTimes = new Set(); 

        vevents.forEach(block => {
            if (block.includes(todayMatch) || block.includes(`VALUE=DATE:${todayMatch}`)) {
                const titleMatch = block.match(/SUMMARY:(.*)/);
                const startMatch = block.match(/DTSTART[:;](?:.*T)?(\d{2})(\d{2})/);
                const endMatch = block.match(/DTEND[:;](?:.*T)?(\d{2})(\d{2})/);
                
                if (titleMatch && startMatch) {
                    const title = titleMatch[1].trim();
                    const sTime = `${startMatch[1]}:${startMatch[2]}`;
                    
                    // Fuzzy Match: If we already have an entry starting at this exact time, skip it
                    if (!takenTimes.has(sTime)) {
                        let eTime = endMatch ? `${endMatch[1]}:${endMatch[2]}` : addMinutes(sTime, 120);
                        renderBrick(sTime, eTime, `📅 ${title}`, "orange", []);
                        takenTimes.add(sTime);
                    }
                }
            }
        });

        // 6. LIVE PROGRESS MARKER
        renderCurrentTimeLine();

    } catch (error) {
        console.error("Dashboard Error:", error);
    }
}

// --- RENDERING ENGINE ---

function renderBrick(start, end, title, colorClass, subtasks) {
    const timeline = document.getElementById('timeline');
    const brickDiv = document.createElement('div');
    brickDiv.className = `brick ${colorClass}`;
    
    // Scale height based on CONFIG.pixelsPerMinute
    const duration = getDurationMinutes(start, end);
    brickDiv.style.minHeight = `${duration * CONFIG.pixelsPerMinute}px`;

    const subHtml = subtasks.length > 0 ? `<ul class="subtasks">${subtasks.map(s => `<li>${s}</li>`).join('')}</ul>` : '';
    const displayTime = `${formatTo12Hr(start)} - ${formatTo12Hr(end)}`;

    brickDiv.innerHTML = `
        <div class="time-label">${displayTime}</div>
        <div class="title">${title}</div>
        ${subHtml}
    `;
    timeline.appendChild(brickDiv);
}

function renderCurrentTimeLine() {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    
    // Line starts tracking from 5:00 AM
    const startHour = 5; 
    if (hours < startHour || hours > 22) return;
    
    const totalMinutes = (hours - startHour) * 60 + minutes;
    let marker = document.getElementById('time-marker') || document.createElement('div');
    marker.id = 'time-marker';
    document.getElementById('timeline').appendChild(marker);
    
    // Sync line position with brick scaling
    marker.style.top = `${totalMinutes * CONFIG.pixelsPerMinute}px`; 
}

// --- FORMATTERS & MATH ---

function formatTo12Hr(timeStr) {
    const [h, m] = timeStr.split(':');
    let hour = parseInt(h);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12 || 12;
    return `${hour}:${m}${ampm}`;
}

function getDurationMinutes(start, end) {
    const [h1, m1] = start.split(':').map(Number);
    const [h2, m2] = end.split(':').map(Number);
    return (h2 * 60 + m2) - (h1 * 60 + m1);
}

function subtractMinutes(t, m) {
    const [h, min] = t.split(':').map(Number);
    const d = new Date(); d.setHours(h, min - m);
    return d.toTimeString().slice(0, 5);
}

function addMinutes(t, m) {
    const [h, min] = t.split(':').map(Number);
    const d = new Date(); d.setHours(h, min + m);
    return d.toTimeString().slice(0, 5);
}

// --- RUN ---
buildMyDay();
setInterval(renderCurrentTimeLine, 60000);
