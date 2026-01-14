// --- CONFIGURATION ---
const CONFIG = {
    scheduleUrl: 'https://raw.githubusercontent.com/scottscalici/loquesea/main/planner/schedule.json',
    calendarUrl: 'https://raw.githubusercontent.com/scottscalici/imagenes/main/planes/calendario.json',
    coziUrl: 'https://corsproxy.io/?' + encodeURIComponent('https://rest.cozi.com/api/ext/1103/f9f7020d-05c9-4720-b813-2155b4485be7/icalendar/feed/feed.ics'),
    pixelsPerMinute: 1.8 
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

        const now = new Date();
        const todayStr = now.toISOString().split('T')[0]; 
        const todayMatch = todayStr.replace(/-/g, ''); 
        
        const rawValue = schedule.overrides[todayStr] || calendar[todayStr] || "A";
        const dayTypeMap = { "A": "A_Day", "B": "B_Day", "PD": "PD_Day", "Work": "PD_Day" };
        const dayTypeKey = dayTypeMap[rawValue] || rawValue;
        
        document.getElementById('day-header').innerText = `${todayStr} (${dayTypeKey})`;
        const timeline = document.getElementById('timeline');
        timeline.innerHTML = '';

        // 1. MORNING LAUNCH
        const dropOff = schedule.hard_stops.school_dropoff;
        const routine = schedule.definitions.routines[dropOff.trigger_routine];
        const wheelsUp = subtractMinutes(dropOff.time, dropOff.commute_minutes);
        const wakeUp = subtractMinutes(wheelsUp, routine.duration);
        renderBrick(wakeUp, wheelsUp, routine.label, "purple", routine.subtasks);

        // 2. FOUNDATION BRICKS
        const dayBricks = schedule.days[dayTypeKey] || [];
        dayBricks.forEach(brick => {
            const temp = schedule.definitions.brick_templates[brick.template] || {color: "grey"};
            const end = brick.end || addMinutes(brick.start, brick.duration);
            renderBrick(brick.start, end, brick.label, temp.color, []);
        });

        // 3. COZI BRICKS (Fixed Duration Logic)
        const vevents = coziText.split("BEGIN:VEVENT");
        let seenEvents = new Set();

        vevents.forEach(block => {
            if (block.includes(todayMatch) || block.includes(`VALUE=DATE:${todayMatch}`)) {
                const titleMatch = block.match(/SUMMARY:(.*)/);
                const startMatch = block.match(/DTSTART[:;](?:.*T)?(\d{2})(\d{2})/);
                // Look for the actual DTEND in the block
                const endMatch = block.match(/DTEND[:;](?:.*T)?(\d{2})(\d{2})/);
                
                if (titleMatch && startMatch) {
                    const title = titleMatch[1].trim();
                    const sTime = `${startMatch[1]}:${startMatch[2]}`;
                    
                    // Use the endMatch time if found, otherwise default to 120 mins (2 hours) for this specific setup
                    let eTime;
                    if (endMatch) {
                        eTime = `${endMatch[1]}:${endMatch[2]}`;
                    } else {
                        eTime = addMinutes(sTime, 120); 
                    }
                    
                    const eventKey = `${title}-${sTime}`;
                    if (!seenEvents.has(eventKey)) {
                        renderBrick(sTime, eTime, `📅 ${title}`, "orange", []);
                        seenEvents.add(eventKey);
                    }
                }
            }
        });

        renderCurrentTimeLine();
    } catch (error) {
        console.error("Engine Error:", error);
    }
}

// --- RENDERING & FORMATTING ---

function formatTo12Hr(timeStr) {
    const [h, m] = timeStr.split(':');
    let hour = parseInt(h);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12 || 12;
    return `${hour}:${m} ${ampm}`;
}

function renderBrick(start, end, title, colorClass, subtasks) {
    const timeline = document.getElementById('timeline');
    const brickDiv = document.createElement('div');
    brickDiv.className = `brick ${colorClass}`;
    
    // Calculate Height based on duration
    const duration = getDurationMinutes(start, end);
    brickDiv.style.minHeight = `${duration * CONFIG.pixelsPerMinute}px`;

    let subHtml = subtasks.length > 0 ? `<ul class="subtasks">${subtasks.map(s => `<li>${s}</li>`).join('')}</ul>` : '';
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
    const startHour = 5; 
    if (hours < startHour || hours > 22) return;
    const totalMinutes = (hours - startHour) * 60 + minutes;
    
    let marker = document.getElementById('time-marker') || document.createElement('div');
    marker.id = 'time-marker';
    document.getElementById('timeline').appendChild(marker);
    marker.style.top = `${totalMinutes * CONFIG.pixelsPerMinute}px`; 
}

// --- UTILITIES ---

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

buildMyDay();
setInterval(renderCurrentTimeLine, 60000);
