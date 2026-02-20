const fs = require('fs');

// Mock browser APIs
global.window = {};
global.document = { 
    getElementById: () => ({ style: {}, classList: { remove: ()=>{}, add: ()=>{} }, addEventListener: ()=>{} }), 
    createElement: () => ({ getContext: () => ({}) }) 
};
global.localStorage = { getItem: () => "0", setItem: () => {} };
global.performance = { now: () => 1000 };
global.requestAnimationFrame = () => {};
global.Image = class {};
global.Audio = class { play(){} };
global.sounds = { play: () => {} };

// Load code
eval(fs.readFileSync('js/config.js', 'utf8'));
eval(fs.readFileSync('js/entities.js', 'utf8'));
eval(fs.readFileSync('app.js', 'utf8').replace(/window\.onload[\s\S]*$/, ''));

// test init
try {
    let mockGame = new Game();
    mockGame.startGame();
    
    mockGame.state.score = 10010; // scoreMeters = 1001
    
    // Simulate multiple frames to trigger % intervals
    for(let i=0; i<60; i++) {
        mockGame.update(1);
    }
    console.log("UPDATE AFTER 1000M SUCCESS");
} catch(e) {
    console.error("CRASH:", e.stack);
}
