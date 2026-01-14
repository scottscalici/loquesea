async function buildMyDay() {
    try {
        // 1. DATA SOURCES
        const scheduleUrl = 'https://raw.githubusercontent.com/scottscalici/loquesea/main/planner/schedule.json';
        const calendarUrl = 'https://raw.githubusercontent.com/scottscalici/imagenes/main/planes/calendario.json';
        // Replace with your actual Cozi URL
        const coziUrl = 'https://corsproxy.io/?' + encodeURIComponent('PASTE_YOUR_COZI_ICS_LINK_HERE');

        const [scheduleRes, calendarRes, coziRes] = await Promise.all([
            fetch(scheduleUrl),
            fetch(calendarUrl),
            fetch(coziUrl)
        ]);

        const schedule = await scheduleRes.json();
        const calendar = await calendarRes.json();
        const coziText = await coziRes.text();

        // 2. DATE & TRANSLATION LOGIC
        const now = new Date();
        const todayStr = now.toISOString().split('T')[0]; 
        const todayClean = todayStr.replace(/-/g, '');

        // GET RAW VALUE (e.g., "A" from Spanish calendar or "PD_Day" from Override)
        const rawValue = schedule.overrides[todayStr] || calendar[todayStr] || "A";

        // TRANSLATION LAYER: Maps Spanish Calendar -> Planner JSON keys
        const dayTypeMap = {
            "A": "A_Day",
            "B": "B_Day",
            "PD": "PD_Day",
            "Work": "PD_Day"
        };
        const dayTypeKey = dayTypeMap[rawValue] || rawValue;
        
        document.getElementById('day-header').innerText = `${todayStr} (${dayTypeKey})`;
        const timeline = document.getElementById('timeline');
        timeline.innerHTML = '';

        // 3. MORNING LAUNCH (Reverse Math)
        if (schedule.hard_stops && schedule.hard_stops.school_dropoff) {
            const dropOff = schedule.hard_stops.school_dropoff;
            const routine = schedule.definitions.routines[dropOff.trigger_routine];
            
            if (routine) {
                const wheelsUp = subtractMinutes(dropOff.time, dropOff.commute_minutes);
                const wakeUp = subtractMinutes(wheelsUp, routine.duration);
                renderBrick(wakeUp, wheelsUp, routine.label, routine.color || "purple", routine.subtasks);
            }
        }

        // 4. FOUNDATION BRICKS (Work/School)
        const dayBricks = schedule.days[dayTypeKey] || [];
        dayBricks.forEach(brick => {
            const template = schedule.definitions.brick_templates[brick.template] || { color: "grey" };
            const start = brick.start;
            const end = brick.end || addMinutes(brick.start, brick.duration);
            renderBrick(start, end, brick.label, template.color, []);
        });

        // 5. COZI BRICKS (Orange)
        const vevents = coziText.split("BEGIN:VEVENT");
        vevents.forEach(block => {
            if (block.includes(todayClean)) {
                const titleMatch = block.match(/SUMMARY:(.*)/);
                const startMatch = block.match(/DTSTART[:;](?:.*T)?(\d{2})(\d{2})/);
                
                if (titleMatch && startMatch) {
                    const sTime = `${startMatch[1]}:${startMatch[2]}`;
                    // Default to 60 min if no end time found
                    renderBrick(sTime, addMinutes(sTime, 60), titleMatch[1].trim(), "orange", []);
                }
            }
        });

    } catch (error) {
        console.error("Critical Engine Failure:", error);
        document.getElementById('day-header').innerText = `Error: Check Console`;
    }
}

// RENDER ENGINE
function renderBrick(start, end, title, colorClass, subtasks) {
    const timeline = document.getElementById('timeline');
    const brickDiv = document.createElement('div');
    brickDiv.className = `brick ${colorClass}`;
    
    let subtasksHtml = '';
    if (subtasks && subtasks.length > 0) {
        subtasksHtml = `<ul class="subtasks">${subtasks.map(s => `<li>${s}</li>`).join('')}</ul>`;
    }

    brickDiv.innerHTML = `
        <div class="time-label">${start} - ${end}</div>
        <div class="title">${title}</div>
        ${subtasksHtml}
    `;
    timeline.appendChild(brickDiv);
}

// UTILITIES
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
