async function buildMyDay() {
    // 1. FETCH DATA
    const scheduleRes = await fetch('https://raw.githubusercontent.com/scottscalici/loquesea/refs/heads/main/planner/schedule.json');
    const calendarRes = await fetch('https://raw.githubusercontent.com/scottscalici/imagenes/refs/heads/main/planes/calendario.json');
    
    const schedule = await scheduleRes.json();
    const calendar = await calendarRes.json();

    // 2. IDENTIFY TODAY'S TYPE
    const todayStr = new Date().toISOString().split('T')[0]; // e.g. "2026-01-14"
    const dayType = calendar[todayStr] || "Default"; // Gets "A", "B", or "PD"

    // 3. THE REVERSE MATH (The "Drop-off" Trigger)
    const dropOff = schedule.hard_stops.school_dropoff;
    const routine = schedule.definitions.routines[dropOff.trigger_routine];

    // Calculate "Wheels Up" time
    const wheelsUp = subtractMinutes(dropOff.time, dropOff.commute_minutes);
    // Calculate "Start Routine" time
    const wakeUp = subtractMinutes(wheelsUp, routine.duration);

    console.log(`Today is ${dayType} Day`);
    console.log(`Wake up at: ${wakeUp} to start ${routine.label}`);
    console.log(`Be in car by: ${wheelsUp}`);
    
    // 4. RENDER TO SCREEN
    renderBrick(wakeUp, wheelsUp, routine);
}

// Utility to handle time math (e.g., "06:45" minus 10 mins = "06:35")
function subtractMinutes(timeStr, mins) {
    const [h, m] = timeStr.split(':').map(Number);
    const date = new Date();
    date.setHours(h, m - mins);
    return date.toTimeString().slice(0, 5);
}
