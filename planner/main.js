async function buildMyDay() {
    try {
        // 1. FETCH DATA
        const scheduleRes = await fetch('https://raw.githubusercontent.com/scottscalici/loquesea/refs/heads/main/planner/schedule.json');
        const calendarRes = await fetch('https://raw.githubusercontent.com/scottscalici/imagenes/refs/heads/main/planes/calendario.json');
        
        const schedule = await scheduleRes.json();
        const calendar = await calendarRes.json();

        // 2. IDENTIFY TODAY
        const now = new Date();
        const todayStr = now.toISOString().split('T')[0]; 
        const dayType = calendar[todayStr] || "A"; // Default to A if not found
        
        document.getElementById('day-header').innerText = `${todayStr} (${dayType} Day)`;

        const timeline = document.getElementById('timeline');
        timeline.innerHTML = ''; // Clear existing

        // 3. CALCULATE MORNING LAUNCH (Reverse Math)
        const dropOff = schedule.hard_stops.school_dropoff;
        const routine = schedule.definitions.routines[dropOff.trigger_routine];
        
        const wheelsUp = subtractMinutes(dropOff.time, dropOff.commute_minutes);
        const wakeUp = subtractMinutes(wheelsUp, routine.duration);

        // 4. RENDER MORNING LAUNCH
        renderBrick(wakeUp, wheelsUp, routine.label, routine.color, routine.subtasks);

        // 5. RENDER DAY-SPECIFIC FOUNDATION (A or B Day)
        const dayBricks = schedule.days[`${dayType}_Day`] || [];
        dayBricks.forEach(brick => {
            // Calculate end time based on duration
            const endTime = addMinutes(brick.start, brick.duration);
            const template = schedule.definitions.brick_templates[brick.template];
            renderBrick(brick.start, endTime, brick.label, template.color, []);
        });

    } catch (error) {
        console.error("Error building the day:", error);
        document.getElementById('day-header').innerText = "Error Loading Schedule";
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

// UTILITIES
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
