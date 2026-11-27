const SHOW_WALLS = false;

// TODO: trace the real tee, cup and walls from each image
// (set SHOW_WALLS = true while tracing). Until then every hole is a
// straight shot from (60, 160) to (540, 160) with no walls.
const COURSES = {
    course1: [
        { image: "images/1.png", tee: { x: 60, y: 160 }, cup: { x: 540, y: 160, radius: 13 }, walls: [] },
        { image: "images/2.png", tee: { x: 60, y: 160 }, cup: { x: 540, y: 160, radius: 13 }, walls: [] },
        { image: "images/3.png", tee: { x: 60, y: 160 }, cup: { x: 540, y: 160, radius: 13 }, walls: [] },
    ],
    course2: [
        { image: "images/4.png", tee: { x: 60, y: 160 }, cup: { x: 540, y: 160, radius: 13 }, walls: [] },
        { image: "images/5.png", tee: { x: 60, y: 160 }, cup: { x: 540, y: 160, radius: 13 }, walls: [] },
        { image: "images/6.png", tee: { x: 60, y: 160 }, cup: { x: 540, y: 160, radius: 13 }, walls: [] },
    ],
    course3: [
        { image: "images/7.png", tee: { x: 60, y: 160 }, cup: { x: 540, y: 160, radius: 13 }, walls: [] },
        { image: "images/8.png", tee: { x: 60, y: 160 }, cup: { x: 540, y: 160, radius: 13 }, walls: [] },
        { image: "images/9.png", tee: { x: 60, y: 160 }, cup: { x: 540, y: 160, radius: 13 }, walls: [] },
    ],
};