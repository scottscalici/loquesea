async function buildMyDay() {
    try {
        // 1. PATHS TO YOUR JSON DATA
        const scheduleUrl = 'https://raw.githubusercontent.com/scottscalici/loquesea/main/planner/schedule.json';
        const calendarUrl = 'https://raw.githubusercontent.com/scottscalici/imagenes/main/planes/calendario.json';
        const coziUrl = 'https://corsproxy.io/?' + encodeURIComponent('PASTE_YOUR_COZI_ICS_LINK_HERE');

        // 2. FETCH ALL DATA SIMULTANEOUSLY
        const [scheduleRes, calendarRes, coziRes] = await Promise.all([
            fetch(scheduleUrl),
            fetch(calendarUrl),
            fetch(coziUrl)
        ]);

        const schedule = await scheduleRes.json();
        const calendar = await calendarRes.json();
        const coziText = await coziRes.text();

        // 3. DATE LOGIC
        const now = new Date();
        const todayStr = now.toISOString().split('T')[0]; 
        const todayClean = todayStr.replace(/-/g, ''); // For Cozi matching
        
        // Determine Day Type: Override (PD) > Calendar (A/B) > Default (A)
        const dayTypeKey = schedule.overrides[todayStr] || calendar[todayStr] || "A_Day";
        
        document.getElementById('day-header').innerText = `${todayStr} (${dayTypeKey})`;
        const timeline = document.getElementById('timeline');
        timeline.innerHTML = '';

        // 4. MORNING LAUNCH (Reverse Math)
        const dropOff = schedule.hard_stops.school_dropoff;
        const routine = schedule.definitions.routines[dropOff.trigger_routine];
        const wheelsUp = subtractMinutes(dropOff.time, dropOff.commute_minutes);
        const wakeUp = subtractMinutes(wheelsUp, routine.duration);
        renderBrick(wakeUp, wheelsUp, routine.label, routine.color, routine.subtasks);

        // 5. FOUNDATION BRICKS (Work/School)
        const dayBricks = schedule.days[dayTypeKey] || [];
        dayBricks.forEach(brick => {
            const template = schedule.definitions.brick_templates[brick.template];
            const start = brick.start;
            const end = brick.end || addMinutes(brick.start, brick.duration);
            renderBrick(start, end, brick.label, template.color, []);
        });

        // 6. COZI VARIABLE BRICKS (Orange)
        const vevents = coziText.split("BEGIN:VEVENT");
        vevents.forEach(block => {
            // Only pull events for today
            if (block.includes(todayClean)) {
                const title = block.match(/SUMMARY:(.*)/)?.[1];
                const startRaw = block.match(/DTSTART[:;](?:.*T)?(\d{2})(\d{2})/);
                const endRaw = block.match(/DTEND[:;](?:.*T)?(\d{2})(\d{2})/);
                
                if (title && startRaw) {
                    const sTime = `${startRaw[1]}:${startRaw[2]}`;
                    const eTime = endRaw ? `${endRaw[1]}:${endRaw[2]}` : addMinutes(sTime, 60);
                    renderBrick(sTime, eTime, title.trim(), "orange", []);
                }
            }
        });

    } catch (error) {
        console.error("The Engine Stalled:", error);
        document.getElementById('day-header').innerText = `Error: ${error.message}`;
    }
}

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

// TIME UTILITIES
function subtractMinutes(timeStr, mins) {
    const [h, m] = timeStr.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m - mins);
    return d.toTimeString().slice(0, 5);
}

function addMinutes(timeStr, mins) {
    const [h, m] = timeStr.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m + mins);
    return d.toTimeString().slice(0, 5);
}
