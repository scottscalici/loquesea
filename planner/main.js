// --- CONFIGURATION ---
const CONFIG = {
    scheduleUrl: 'https://raw.githubusercontent.com/scottscalici/loquesea/main/planner/schedule.json',
    calendarUrl: 'https://raw.githubusercontent.com/scottscalici/imagenes/main/planes/calendario.json',
    // Replace the URL below with your actual Cozi ICS link
    coziUrl: 'https://corsproxy.io/?' + encodeURIComponent('https://rest.cozi.com/api/ext/1103/f9f7020d-05c9-4720-b813-2155b4485be7/icalendar/feed/feed.ics'),
    pixelsPerMinute: 1.8 // This controls how fast the red line moves down the screen
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

        // 1. DATE & TRANSLATION LOGIC
        const now = new Date();
        const todayStr = now.toISOString().split('T')[0]; 
        const todayMatch = todayStr.replace(/-/g, ''); // Format: 20260114
        
        // Map Spanish Calendar keys to your Planner JSON keys
        const rawValue = schedule.overrides[todayStr] || calendar[todayStr] || "A";
        const dayTypeMap = { "A": "A_Day", "B": "B_Day", "PD": "PD_Day", "Work": "PD_Day" };
        const dayTypeKey = dayTypeMap[rawValue] || rawValue;
        
        document.getElementById('day-header').innerText = `${todayStr} (${dayTypeKey})`;
        const timeline = document.getElementById('timeline');
        timeline.innerHTML = '';

        // 2. MORNING LAUNCH (Reverse Math)
        const dropOff = schedule.hard_stops.school_dropoff;
        const routine = schedule.definitions.routines[dropOff.trigger_routine];
        const wheelsUp = subtractMinutes(dropOff.time, dropOff.commute_minutes);
        const wakeUp = subtractMinutes(wheelsUp, routine.duration);
        renderBrick(wakeUp, wheelsUp, routine.label, "purple", routine.subtasks);

        // 3. FOUNDATION BRICKS (Work/School)
        const dayBricks = schedule.days[dayTypeKey] || [];
        dayBricks.forEach(brick => {
            const temp = schedule.definitions.brick_templates[brick.template] || {color: "grey"};
            const end = brick.end || addMinutes(brick.start, brick.duration);
            renderBrick(brick.start, end, brick.label, temp.color, []);
        });

        // 4. COZI BRICKS (Orange)
        const vevents = coziText.split("BEGIN:VEVENT");
        let coziFound = false;
        vevents.forEach(block => {
            if (block.includes(todayMatch) || block.includes(`VALUE=DATE:${todayMatch}`)) {
                const titleMatch = block.match(/SUMMARY:(.*)/);
                const startMatch = block.match(/DTSTART[:;](?:.*T)?(\d{2})(\d{2})/);
                if (titleMatch && startMatch) {
                    coziFound = true;
                    const sTime = `${startMatch[1]}:${startMatch[2]}`;
                    renderBrick(sTime, addMinutes(sTime, 60), `📅 ${titleMatch[1].trim()}`, "orange", []);
                }
            }
        });

        // 5. FOOTER & TIME MARKER
        renderCurrentTimeLine();
        const lastSync = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const footer = document.createElement('div');
        footer.style.cssText = "text-align:center; font-size:0.7rem; color:#999; margin-top:20px; padding-bottom:20px;";
        footer.innerText = `Last Sync: ${lastSync} ${coziFound ? '' : '(No Cozi events)'}`;
        timeline.appendChild(footer);

    } catch (error) {
        console.error("Engine Error:", error);
        document.getElementById('day-header').innerText = `Error: ${error.message}`;
    }
}

// --- CORE FUNCTIONS ---

function renderBrick(start, end, title, colorClass, subtasks) {
    const timeline = document.getElementById('timeline');
    const brickDiv = document.createElement('div');
    brickDiv.className = `brick ${colorClass}`;
    
    let subtasksHtml = subtasks.length > 0 
        ? `<ul class="subtasks">${subtasks.map(s => `<li>${s}</li>`).join('')}</ul>` 
        : '';

    brickDiv.innerHTML = `
        <div class="time-label">${start} - ${end}</div>
        <div class="title">${title}</div>
        ${subtasksHtml}
    `;
    timeline.appendChild(brickDiv);
}

function renderCurrentTimeLine() {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    
    // Timeline starts calculating from 5:00 AM
    const startHour = 5; 
    if (hours < startHour || hours > 22) return;

    const totalMinutes = (hours - startHour) * 60 + minutes;
    
    let marker = document.getElementById('time-marker');
    if (!marker) {
        marker = document.createElement('div');
        marker.id = 'time-marker';
        document.getElementById('timeline').appendChild(marker);
    }
    
    // Position the red line based on total minutes passed since 5am
    marker.style.top = `${totalMinutes * CONFIG.pixelsPerMinute}px`; 
}

// --- TIME UTILITIES ---

function subtractMinutes(timeStr, mins) {
    const [h, m] = timeStr.split(':').map(Number);
    const d = new Date(); d.setHours(h, m - mins);
    return d.toTimeString().slice(0, 5);
}

function addMinutes(timeStr, mins) {
    const [h, m] = timeStr.split(':').map(Number);
    const d = new Date(); d.setHours(h, m + mins);
    return d.toTimeString().slice(0, 5);
}

// Kickstart the clock and refresh line position every minute
setInterval(renderCurrentTimeLine, 60000);
