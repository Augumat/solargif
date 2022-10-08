/**
 * @fileoverview Loads or randomly generates a solar system, then generates a gif of it.
 * @author Matthew Augustyn
 */
const fs = require('fs');
const path = require('path');
//const prog = require('cli-progress');
const { createCanvas } = require('canvas');
const GIFEncoder = require('gifencoder');
const pngFileStream = require('png-file-stream');
const { gcd } = require('mathjs');

// command-line-args setup
const CLA_OPTIONS = [
    //{ group: 'utility', name: 'help' },
    //{ group: 'files', name: 'configFile', alias: 'c', type: String, defaultOption: true },
    //{ group: 'files', name: 'planetFile', alias: 'p', type: String },
    { group: 'generation', name: 'starDensity', alias: 's', type: Number, defaultValue: 0.03125 },
    { group: 'generation', name: 'numPlanets', alias: 'n', type: Number, defaultValue: 4 },
    { group: 'generation', name: 'sunSize', alias: 'c', type: Number, defaultValue: 10 },
    { group: 'generation', name: 'sunAlignment', alias: 'a', type: String, defaultValue: 'center' },
    { group: 'output', name: 'trailFraction', alias: 'f', type: Number, defaultValue: 8 },
    { group: 'output', name: 'outputWidth', alias: 'w', type: Number, defaultValue: 640 },
    { group: 'output', name: 'outputHeight', alias: 'h', type: Number, defaultValue: 640 },
    { group: 'output', name: 'perfectLoop', alias: 'l', type: Boolean, defaultValue: false },
    { group: 'output', name: 'delayPerFrame', alias: 'd', type: Number, defaultValue: 33 },
    { group: 'output', name: 'totalFrames', alias: 't', type: Number, defaultValue: 16 }
];
const CLA = require('command-line-args');
const ARGUMENTS = CLA(CLA_OPTIONS);

// canvas vars
var canvas;
var ctx;
var canvasWidth;
var canvasHeight;
var sunX;
var sunY;

// constants
const MINIMUM_OUTPUT_DIMENSION = 64;
const MAXIMUM_PLANET_SIZE = 4;
const COLORSPACE_SIZE = 16777215;
const MAX_PAD = 8;

// math constants
const PI      = Math.PI;
const DEG_0   = 0.0;
const DEG_45  = 0.25 * PI;
const DEG_90  = 2 * DEG_45;
const DEG_135 = 3 * DEG_45;
const DEG_180 = 4 * DEG_45;
const DEG_225 = 5 * DEG_45;
const DEG_270 = 6 * DEG_45;
const DEG_315 = 7 * DEG_45;
const DEG_360 = 8 * DEG_45;

// stellar bodies
var planets;
var stars;

// orbital velocity approximation (see https://www.desmos.com/calculator/wttvhfa8j9)
const f2 = (n) => (0.5 * (1.0 + (1.0 / Math.sqrt(n / (n + 4.0)))));
const f1 = (x, n) => (0.5 * ((-1.0 / (n * ((2.0 * x) - f2(n)))) - f2(n))) + 0.5;
function getInterpolatedTime(t, s) {
    if (t < 0.0 || t > 1.0) {
        console.log(`[getInterpolatedTime] invalid t: ${t}`);
        return 0.0;
    } else if (t < 0.5) {
        return (((1.0 - s) * f1(t, 1.0 / s)) + (s * t));
    } else {
        return (1.0 - (((1.0 - s) * f1((1.0 - t), 1.0 / s)) + (s * (1.0 - t))));
    }
}

/**
 * Finds the position to display a given planet at.
 * 
 * @param {Orbit} pl The planet.
 * @param {Integer} t The time to find the planet's position at.
 * @returns {Object} An object with an x and y field describing the x and y
 *                   coordinates of the planet's center at the specified time.
 */
function getPlanetPosition(pl, t) {
    // grab the orbit object from the planet
    var orb = pl.orbit;

    // get the correct time relative to the planet's starting point and period
    var relT = ((t + orb.orbitalOffset) % orb.orbitalPeriod) / orb.orbitalPeriod;

    // grab the radial position at the given time from the planet data
    // (position is pre-computed at every time within the orbital period)
    var radialPos = (DEG_360 * getInterpolatedTime(relT, 1.0 - orb.E)) + DEG_180;

    // find the x and y coordinates using the parametric closed form of a
    // rotated ellipse
    var x_out = (orb.R_maj * Math.cos(radialPos) * Math.cos(DEG_90 + orb.Theta))
              - (orb.R_min * Math.sin(radialPos) * Math.sin(DEG_90 + orb.Theta))
              + orb.C_x;
    var y_out = (orb.R_maj * Math.cos(radialPos) * Math.sin(DEG_90 + orb.Theta))
              + (orb.R_min * Math.sin(radialPos) * Math.cos(DEG_90 + orb.Theta))
              + orb.C_y;

    // return an object with the x and y coordinates
    return {
        x: Math.round(x_out),
        y: Math.round(y_out)
    };
}

// ellipse perimeter approximation (see https://www.mathsisfun.com/geometry/ellipse-perimeter.html)
function ellipsePerim(a, b) {
    return PI * ((3 * (a + b)) - Math.sqrt(((3*a) + b) * (a + (3*b))));
}

/**
 * temp
 * @param {*} pl temp
 * @returns temp
 */
function initializePlanet(pl) {
    // generate random size and color if not already included
    if (pl.size == null) { pl.size = Math.ceil(Math.random() * MAXIMUM_PLANET_SIZE); }
    if (pl.color == null) { pl.color = `#${(Math.round(Math.random() * COLORSPACE_SIZE)).toString(16)}`; }

    // get the maximum allowed radius (higher could go offscreen)
    let maxRadius = Math.min(canvasWidth, canvasHeight) / 4.0;
    let minRadius = ARGUMENTS.generation.sunSize;
    // TODO remake this to be more tightly bounded and allow for long
    // ellipticals on non-square canvases

    // generate base orbit values if not already included
    if (pl.orbit == null) { pl.orbit = {}; }
    if (pl.orbit.R_maj == null) { pl.orbit.R_maj = Math.round(minRadius + (Math.random() * (maxRadius - minRadius))); }
    if (pl.orbit.R_min == null) { pl.orbit.R_min = Math.round(Math.random() * pl.orbit.R_maj); }
    if (pl.orbit.Theta == null) { pl.orbit.Theta = Math.random() * DEG_360; }
    if (pl.orbit.orbitalPeriod == null) { pl.orbit.orbitalPeriod = Math.round(ellipsePerim(pl.orbit.R_min, pl.orbit.R_maj)); }
    if (pl.orbit.orbitalOffset == null) { pl.orbit.orbitalOffset = Math.floor(Math.random() * pl.orbit.orbitalPeriod); }

    // populate derived fields
    let c = Math.sqrt((pl.orbit.R_maj * pl.orbit.R_maj) - (pl.orbit.R_min * pl.orbit.R_min));
    pl.orbit.C_x = Math.floor(sunX + (c * Math.sin(pl.orbit.Theta)));
    pl.orbit.C_y = Math.floor(sunY - (c * Math.cos(pl.orbit.Theta)));
    pl.orbit.E = Math.sqrt(1.0 - ((pl.orbit.R_min * pl.orbit.R_min) / (pl.orbit.R_maj * pl.orbit.R_maj)));

    // send the initialized planet back 
    return pl;
}

/**
 * Renders a frame for time t directly to the canvas.
 */
async function renderFrame(t) {
    // fill background
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    
    // draw stars
    for (var i = 0; i < stars.length; i++) {
        switch (stars[i].brightness) {
            case 0:  ctx.fillStyle = "#111100"; break;
            case 1:  ctx.fillStyle = "#444400"; break;
            case 2:  ctx.fillStyle = "#888833"; break;
            case 3:  ctx.fillStyle = "#BBBB66"; break;
            default: ctx.fillStyle = "#FFFF99"; break;
        }
        // draw the star (pixel)
        ctx.fillRect(
            stars[i].x,
            stars[i].y,
            1, 1
        );
    }

    // draw sun
    ctx.fillStyle = "#FFFF00";
    ctx.beginPath();
    ctx.ellipse(sunX - 1, sunY - 1, ARGUMENTS.generation.sunSize, ARGUMENTS.generation.sunSize, 0, DEG_0, DEG_360);
    ctx.fill();

    // draw trails
    if (ARGUMENTS.output.trailFraction != 0) {
        for (var i = 0; i < planets.length; i++) {
            // grab current planet info
            var cur = planets[i];
            var orb = cur.orbit;
            // calculate when to start and stop the arc
            var startArc = t - Math.floor(orb.orbitalPeriod / ARGUMENTS.output.trailFraction);
            var startT = ((startArc + orb.orbitalOffset) % orb.orbitalPeriod) / orb.orbitalPeriod;
            if (startT < 0) { startT += 1.0; }
            var endT = ((t + orb.orbitalOffset) % orb.orbitalPeriod) / orb.orbitalPeriod;
            var startAngle = (DEG_360 * getInterpolatedTime(startT, 1.0 - orb.E)) + DEG_270;
            var endAngle = (DEG_360 * getInterpolatedTime(endT, 1.0 - orb.E)) + DEG_270;
            // draw a portion of the orbit (elliptic arc)
            ctx.strokeStyle = cur.color;
            ctx.beginPath();
            ctx.ellipse(orb.C_x, orb.C_y, orb.R_min, orb.R_maj, orb.Theta, startAngle, endAngle);
            ctx.stroke();
        }
    }

    // draw planets
    for (var i = 0; i < planets.length; i++) {
        // grab current planet info
        var cur = planets[i];
        var { x, y } = getPlanetPosition(cur, t);
        // draw the planet (circle)
        ctx.fillStyle = cur.color;
        ctx.beginPath();
        ctx.ellipse(x, y, cur.size, cur.size, 0, DEG_0, DEG_360);
        ctx.fill();
    }
}

function areArgumentsInvalid() {
    // track whether there are issues with any of the arguments
    var isInvalid = false;

    // generation options
    if (ARGUMENTS.generation.starDensity < 0 || ARGUMENTS.generation.starDensity > 1) {
        console.log(`[ERROR] --starDensity (-d) must be a number from 0 to 1 (inclusive)`);
        isInvalid = true;
    }
    if (ARGUMENTS.generation.numPlanets < 1 || !Number.isInteger(ARGUMENTS.generation.numPlanets)) {
        console.log(`[ERROR] --numPlanets (-n) must be an integer greater than 0`);
        isInvalid = true;
    }
    if (ARGUMENTS.generation.sunSize < 1 || !Number.isInteger(ARGUMENTS.generation.sunSize)) {
        console.log(`[ERROR] --sunSize (-c) must be an integer greater than 0`);
        isInvalid = true;
    }
    if (!(ARGUMENTS.generation.sunAlignment === 'center'
       || ARGUMENTS.generation.sunAlignment === 'left'
       || ARGUMENTS.generation.sunAlignment === 'right'
       || ARGUMENTS.generation.sunAlignment === 'top'
       || ARGUMENTS.generation.sunAlignment === 'bottom'
    )) {
        console.log(`[ERROR] --sunAlignment (-a) must be one of the following Strings: "center", "left", "right", "top", "bottom"`);
        isInvalid = true;
    }

    // output options
    if (ARGUMENTS.output.trailFraction < 0) {
        console.log(`[ERROR] --trailFraction (-f) must be a positive number`);
        isInvalid = true;
    }
    if (ARGUMENTS.output.outputWidth < MINIMUM_OUTPUT_DIMENSION || !Number.isInteger(ARGUMENTS.output.outputWidth)) {
        console.log(`[ERROR] --canvasWidth (-w) must be an integer greater than or equal to ${MINIMUM_OUTPUT_DIMENSION}`);
        isInvalid = true;
    }
    if (ARGUMENTS.output.outputHeight < MINIMUM_OUTPUT_DIMENSION || !Number.isInteger(ARGUMENTS.output.outputHeight)) {
        console.log(`[ERROR] --canvasHeight (-h) must be an integer greater than or equal to ${MINIMUM_OUTPUT_DIMENSION}`);
        isInvalid = true;
    }
    if (ARGUMENTS.output.delayPerFrame < 1 || !Number.isInteger(ARGUMENTS.output.delayPerFrame)) {
        console.log(`[ERROR] --delayPerFrame (-d) must be an integer less than ${MINIMUM_OUTPUT_DIMENSION}`);
        isInvalid = true;
    }
    if (ARGUMENTS.output.totalFrames < 1 || !Number.isInteger(ARGUMENTS.output.totalFrames)) {
        console.log(`[ERROR] --totalFrames (-t) must be an integer greater than 0`);
        isInvalid = true;
    }

    // return true if any of the 
    return isInvalid;
}

/**
 * 
 * @param {*} arr 
 * @returns 
 */
function multipleLCM(arr) {
    var out = arr[0];
    for (var i = 1; i < arr.length; i++) {
        out = (arr[i] * out) / gcd(arr[i], out);
    }
    return out;
}

async function main() {
    //debug
    //console.log(ARGUMENTS);

    // show help and exit if requested
    // if (ARGUMENTS.utility.help) {
    //     //todo
    //     return;
    // }

    // validate arguments
    if (areArgumentsInvalid()) { return; }

    // create progress bar
    //todo

    // initialize the canvas
    canvasWidth = ARGUMENTS.output.outputWidth;
    canvasHeight = ARGUMENTS.output.outputHeight;
    canvas = createCanvas(canvasWidth, canvasHeight);
    ctx = canvas.getContext('2d');

    // position sun
    switch (ARGUMENTS.generation.sunAlignment) {
        case 'center':
            sunX = Math.floor(canvasWidth / 2);
            sunY = Math.floor(canvasHeight / 2);
            break;
        case 'left':
            sunX = Math.min(Math.floor(canvasHeight / 2), Math.floor(canvasWidth / 2));
            sunY = Math.floor(canvasHeight / 2);
            break;
        case 'right':
            sunX = canvasWidth - Math.min(Math.floor(canvasHeight / 2), Math.floor(canvasWidth / 2));
            sunY = Math.floor(canvasHeight / 2);
            break;
        case 'top':
            sunX = Math.floor(canvasWidth / 2);
            sunY = Math.min(Math.floor(canvasWidth / 2), Math.floor(canvasHeight / 2));
            break;
        case 'bottom':
            sunX = Math.floor(canvasWidth / 2);
            sunY = canvasHeight - Math.min(Math.floor(canvasWidth / 2), Math.floor(canvasHeight / 2));
            break;
        default:
            return;
    }

    // generate stars
    stars = [];
    const numStars = Math.floor(canvasWidth * canvasHeight * ARGUMENTS.generation.starDensity);
    for (let i = 0; i < numStars; i++) {
        stars.push({
            x: Math.floor(Math.random() * canvasWidth),
            y: Math.floor(Math.random() * canvasHeight),
            brightness: 4 - Math.floor(Math.sqrt(Math.random() * 25))
        });
    }
    
    // generate planets
    planetSeeds = [];
    for (let i = 0; i < ARGUMENTS.generation.numPlanets; i++) {
        planetSeeds.push({});
        //todo add config loading for planet initial values
    }

    // initialize planets
    planets = planetSeeds.map(initializePlanet);
    /*update progress bar*/

    // create a temporary folder for the gif frames
    fs.mkdir(path.join(__dirname, 'temp'), e => {
        if (e) { throw e; }
        else { /*update progress bar*/ }
    });

    // 
    let numFrames = ARGUMENTS.output.totalFrames;
    if (ARGUMENTS.output.perfectLoop) {
        numFrames = multipleLCM(planets.map(x => x.orbit.orbitalPeriod));
    }

    // generate frames and save them to the temporary folder
    for (let t = 0; t < numFrames; t++) {
        await (async () => {
            await renderFrame(t);
            const outStream = fs.createWriteStream(path.join(__dirname, `temp/frame${String(t).padStart(MAX_PAD, '0')}.png`));
            const pngStream = canvas.createPNGStream();
            pngStream.pipe(outStream);
            await new Promise((res, rej) => {
                outStream.on('finish', res);
                outStream.on('error', rej);
            });
        })().catch(console.error);
        // console.log(`wrote ${t}`);
        /*update progress bar*/
    }

    // combine the frames into a gif
    const gifEncoder = new GIFEncoder(canvasWidth, canvasHeight);
    const gifBuilder = pngFileStream(`temp/frame????????.png`)
        .pipe(gifEncoder.createWriteStream({
            repeat: 0,
            delay: ARGUMENTS.output.delayPerFrame,
            quality: 10
        }))
        .pipe(fs.createWriteStream('output.gif'));
    await new Promise((resolve, reject) => {
        gifBuilder.on('finish', resolve);
        gifBuilder.on('error', reject);
    });

    // clean up temp folder
    fs.rm(path.join(__dirname, 'temp'), { recursive: true }, e => {
        if (e) { throw e; }
        else { /*update progress bar*/ }
    });
} main();
