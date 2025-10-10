// Live Lower Thirds JSON Endpoint
// This file serves JSON data that VMIX can poll

(function() {
    'use strict';
    
    // Get eventId from URL parameters
    function getEventId() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('eventId');
    }
    
    // Generate lower thirds JSON
    function generateLowerThirdsJSON(schedule, masterStartTime) {
        // Calculate start time function
        const calculateStartTime = (index) => {
            if (!masterStartTime) return '';
            
            let totalMinutes = 0;
            for (let i = 0; i < index; i++) {
                const item = schedule[i];
                totalMinutes += (item.durationHours * 60) + item.durationMinutes;
            }
            
            const [hours, minutes] = masterStartTime.split(':').map(Number);
            const startDate = new Date();
            startDate.setHours(hours, minutes + totalMinutes, 0, 0);
            
            return startDate.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });
        };

        // Create 7 speaker sections
        const speakerSections = {
            speaker1: [],
            speaker2: [],
            speaker3: [],
            speaker4: [],
            speaker5: [],
            speaker6: [],
            speaker7: []
        };

        schedule.forEach((item, itemIndex) => {
            if (item.speakersText && item.speakersText.trim()) {
                try {
                    const speakersArray = JSON.parse(item.speakersText);
                    const sortedSpeakers = speakersArray.sort((a, b) => a.slot - b.slot);
                    
                    sortedSpeakers.forEach((speaker) => {
                        const speakerSlot = speaker.slot;
                        const speakerKey = `speaker${speakerSlot}`;
                        
                        if (speakerSlot >= 1 && speakerSlot <= 7) {
                            const speakerData = {
                                row: itemIndex + 1,
                                cue: item.customFields?.cue || '',
                                program: item.programType || '',
                                name: speaker.fullName || '',
                                titleOrg: speaker.title && speaker.org 
                                    ? `${speaker.title}\n${speaker.org}`
                                    : speaker.title || speaker.org || '',
                                photo: speaker.photoLink || ''
                            };
                            
                            speakerSections[speakerKey].push(speakerData);
                        }
                    });
                } catch (error) {
                    console.log('Error parsing speakers JSON:', error);
                }
            }
        });

        return {
            event: 'Current Event',
            generated: new Date().toISOString(),
            lowerThirds: speakerSections
        };
    }
    
    // Load data and return JSON
    function loadAndReturnJSON() {
        try {
            const eventId = getEventId();
            if (!eventId) {
                return {
                    error: 'No eventId provided in URL parameters',
                    generated: new Date().toISOString()
                };
            }

            // Try to get data from localStorage
            const scheduleKey = `runOfShowSchedule_${eventId}`;
            const savedSchedule = localStorage.getItem(scheduleKey);
            
            if (!savedSchedule) {
                return {
                    error: 'No schedule data found for event: ' + eventId,
                    generated: new Date().toISOString()
                };
            }

            const schedule = JSON.parse(savedSchedule);
            
            // Get master start time
            const masterTimeKey = `masterStartTime_${eventId}`;
            const masterStartTime = localStorage.getItem(masterTimeKey) || '';

            // Generate and return JSON
            return generateLowerThirdsJSON(schedule, masterStartTime);

        } catch (error) {
            return {
                error: 'Error loading data: ' + error.message,
                generated: new Date().toISOString()
            };
        }
    }
    
    // Return the JSON data
    const jsonData = loadAndReturnJSON();
    
    // Set content type and return JSON
    if (typeof document !== 'undefined') {
        document.body.innerHTML = '<pre>' + JSON.stringify(jsonData, null, 2) + '</pre>';
    }
    
    // For direct access, return the JSON
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = jsonData;
    }
    
    // Make it available globally
    if (typeof window !== 'undefined') {
        window.lowerThirdsData = jsonData;
    }
    
})();

