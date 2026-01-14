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

        const schedule = await scheduleRes.json();
        const calendar = await calendarRes.json();
        const coziText = await coziRes.text();

        // 1. DATE LOGIC
        const now = new Date();
        const todayStr = now.toISOString().split('T')[0]; 
        const todayMatch = todayStr.replace(/-/g, ''); // Format: 20260114
        
        // TRANSLATION LAYER: Spanish Calendar -> Planner Keys
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
        renderBrick(subtractMinutes(wheelsUp, routine.duration), wheelsUp, routine.label, "purple", routine.subtasks);

        // 3. FOUNDATION BRICKS (Work/School)
        const dayBricks = schedule.days[dayTypeKey] || [];
        dayBricks.forEach(brick => {
            const temp = schedule.definitions.brick_templates[brick.template] || {color: "grey"};
            renderBrick(brick.start, brick.end || addMinutes(brick.start, brick.duration), brick.label, temp.color, []);
        });

        // 4. COZI VARIABLE BRICKS (Orange)
        const vevents = coziText.split("BEGIN:VEVENT");
        let coziFound = false;

        vevents.forEach(block => {
            // Check for today's date (handles standard and 'VALUE=DATE' formats)
            if (block.includes(todayMatch) || block.includes(`VALUE=DATE:${todayMatch}`)) {
                const titleMatch = block.match(/SUMMARY:(.*)/);
                const startMatch = block.match(/DTSTART[:;](?:.*T)?(\d{2})(\d{2})/);
                const endMatch = block.match(/DTEND[:;](?:.*T)?(\d{2})(\d{2})/);
                
                if (titleMatch && startMatch) {
                    coziFound = true;
                    const sTime = `${startMatch[1]}:${startMatch[2]}`;
                    const eTime = endMatch ? `${endMatch[1]}:${endMatch[2]}` : addMinutes(sTime, 60);
                    renderBrick(sTime, eTime, `📅 ${titleMatch[1].trim()}`, "orange", []);
                }
            }
        });

        // 5. FOOTER & DEBUG INFO
        const lastUpdated = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const footerInfo = coziFound ? `Last Sync: ${lastUpdated}` : `Last Sync: ${lastUpdated} (No Cozi events today)`;
        
        const footer = document.createElement('div');
        footer.style.cssText = "text-align:center; font-size:0.7rem; color:#999; margin-top:20px; padding-bottom:20px;";
        footer.innerText = footerInfo;
        timeline.appendChild(footer);

    } catch (error) {
        console.error("Engine Error:", error);
        document.getElementById('day-header').innerText = `Error: ${error.message}`;
    }
}

// RENDER ENGINE
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
