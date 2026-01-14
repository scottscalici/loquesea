async function buildMyDay() {
    try {
        const scheduleUrl = 'https://raw.githubusercontent.com/scottscalici/loquesea/main/planner/schedule.json';
        const calendarUrl = 'https://raw.githubusercontent.com/scottscalici/imagenes/main/planes/calendario.json';
        // Replace the placeholder below with your actual Cozi URL
        const coziUrl = 'https://corsproxy.io/?' + encodeURIComponent('PASTE_YOUR_COZI_ICS_LINK_HERE');

        const [scheduleRes, calendarRes, coziRes] = await Promise.all([
            fetch(scheduleUrl),
            fetch(calendarUrl),
            fetch(coziUrl)
        ]);

        if (!scheduleRes.ok) throw new Error("Schedule file not found on GitHub");
        
        const schedule = await scheduleRes.json();
        const calendar = await calendarRes.json();
        const coziText = await coziRes.text();

        const now = new Date();
        const todayStr = now.toISOString().split('T')[0]; 
        const todayClean = todayStr.replace(/-/g, '');
        
        // Priority: Override -> Calendar -> Default
        const dayTypeKey = schedule.overrides[todayStr] || calendar[todayStr] || "A_Day";
        
        document.getElementById('day-header').innerText = `${todayStr} (${dayTypeKey})`;
        const timeline = document.getElementById('timeline');
        timeline.innerHTML = '';

        // 1. MORNING LAUNCH
        const dropOff = schedule.hard_stops.school_dropoff;
        const routine = schedule.definitions.routines[dropOff.trigger_routine];
        const wheelsUp = subtractMinutes(dropOff.time, dropOff.commute_minutes);
        const wakeUp = subtractMinutes(wheelsUp, routine.duration);
        renderBrick(wakeUp, wheelsUp, routine.label, routine.color, routine.subtasks);

        // 2. FOUNDATION BRICKS
        const dayBricks = schedule.days[dayTypeKey] || [];
        dayBricks.forEach(brick => {
            const template = schedule.definitions.brick_templates[brick.template];
            const start = brick.start;
            const end = brick.end || addMinutes(brick.start, brick.duration);
            renderBrick(start, end, brick.label, template.color, []);
        });

        // 3. COZI BRICKS
        const vevents = coziText.split("BEGIN:VEVENT");
        vevents.forEach(block => {
            if (block.includes(todayClean)) {
                const title = block.match(/SUMMARY:(.*)/)?.[1];
                const startMatch = block.match(/DTSTART[:;](?:.*T)?(\d{2})(\d{2})/);
                const endMatch = block.match(/DTEND[:;](?:.*T)?(\d{2})(\d{2})/);
                
                if (title && startMatch) {
                    const sTime = `${startMatch[1]}:${startMatch[2]}`;
                    const eTime = endMatch ? `${endMatch[1]}:${endMatch[2]}` : addMinutes(sTime, 60);
                    renderBrick(sTime, eTime, title.trim(), "orange", []);
                }
            }
        });

    } catch (error) {
        console.error("Engine Error:", error);
        document.getElementById('day-header').innerText = `Error: ${error.message}`;
    }
}

// THE RENDER FUNCTION (Unified name)
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
