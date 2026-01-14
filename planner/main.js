async function buildMyDay() {
    try {
        console.log("Starting fetch...");
        
        // Use the cleanest possible RAW links
        const scheduleUrl = 'https://raw.githubusercontent.com/scottscalici/loquesea/main/planner/schedule.json';
        const calendarUrl = 'https://raw.githubusercontent.com/scottscalici/imagenes/main/planes/calendario.json';

        const [scheduleRes, calendarRes] = await Promise.all([
            fetch(scheduleUrl),
            fetch(calendarUrl)
        ]);

        if (!scheduleRes.ok) throw new Error(`Schedule fetch failed: ${scheduleRes.status}`);
        if (!calendarRes.ok) throw new Error(`Calendar fetch failed: ${calendarRes.status}`);

        const schedule = await scheduleRes.json();
        const calendar = await calendarRes.json();
        
        console.log("Data loaded successfully", { schedule, calendar });

        // ... rest of your logic remains the same ...
        renderTimeline(schedule, calendar);

    } catch (error) {
        console.error("The Engine Stalled:", error);
        document.getElementById('day-header').innerText = `Error: ${error.message}`;
    }
}
