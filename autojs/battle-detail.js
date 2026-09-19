const deviceWidth = device.width;
const deviceHeight = device.height;
const middleX = deviceWidth / 2;

// Ignore tiny rendering changes, while still detecting movement of report text.
var SAMPLE_STEP = 12;
var COLOR_TOLERANCE = 20; // Per RGB channel, on a 0–255 scale.
var MAX_CHANGED_RATIO = 0.001; // Allow at most 0.1% of samples to differ more.
var reportPixelBuffer = null;

function sampleReport(img) {
    var width = img.getWidth();
    var height = img.getHeight();
    var pixels = [];

    // Sample the scrolling report, excluding the header, left round selector,
    // floating AutoJS button, and bottom controls on this phone's layout.
    var left = Math.floor(width * 0.18);
    var top = Math.floor(height * 0.12);
    var reportWidth = Math.floor(width * 0.96) - left;
    var reportHeight = Math.floor(height * 0.88) - top;

    // One bulk Android call avoids thousands of images.pixel() calls. Reuse
    // the buffer between captures, retaining only sampled JS numbers below.
    var pixelCount = reportWidth * reportHeight;
    if (reportPixelBuffer === null || reportPixelBuffer.length !== pixelCount) {
        reportPixelBuffer = java.lang.reflect.Array.newInstance(java.lang.Integer.TYPE, pixelCount);
    }
    img.getBitmap().getPixels(reportPixelBuffer, 0, reportWidth,
        left, top, reportWidth, reportHeight);

    for (var y = 0; y < reportHeight; y += SAMPLE_STEP) {
        var rowOffset = y * reportWidth;
        for (var x = 0; x < reportWidth; x += SAMPLE_STEP) {
            pixels.push(reportPixelBuffer[rowOffset + x] | 0);
        }
    }

    return { width: width, height: height, pixels: pixels };
}

function reportsMatch(previous, current) {
    if (!previous || previous.width !== current.width || previous.height !== current.height ||
        previous.pixels.length !== current.pixels.length || current.pixels.length === 0) {
        return false;
    }

    var changed = 0;
    for (var i = 0; i < current.pixels.length; i++) {
        var a = previous.pixels[i];
        var b = current.pixels[i];
        // Extract RGB channels locally instead of calling colors.* per pixel.
        if (Math.abs(((a >>> 16) & 255) - ((b >>> 16) & 255)) > COLOR_TOLERANCE ||
            Math.abs(((a >>> 8) & 255) - ((b >>> 8) & 255)) > COLOR_TOLERANCE ||
            Math.abs((a & 255) - (b & 255)) > COLOR_TOLERANCE) {
            changed++;
        }
    }

    var changedRatio = changed / current.pixels.length;
    console.log("Report pixels changed: " + (changedRatio * 100).toFixed(3) + "%");
    return changedRatio <= MAX_CHANGED_RATIO;
}

// Function to save screenshot
function saveScreenshot(img) {
    // Generate filename with timestamp
    var timestamp = new Date().getTime();

    // Get the appropriate storage path
    var storagePath = files.getSdcardPath();
    if (!storagePath || storagePath == "") {
        console.error("Error: No storage path available");
        return false;
    }

    // Create Pictures/Screenshots directory
    var screenshotsDir = files.join(storagePath, "Pictures", "Screenshots");
    files.ensureDir(screenshotsDir);

    var filename = files.join(screenshotsDir, "battle_detail_" + timestamp + ".png");

    // Save screenshot
    var saved = images.save(img, filename);

    if (saved) {
        console.log("Screenshot saved to: " + filename);
        // Notify Android media scanner so Gallery app can see the file immediately
        media.scanFile(filename);
    } else {
        console.log("Failed to save screenshot");
    }

    return saved;
}

// Function to scroll down by a single swipe.
// We start from the middle of the screen because the bottom of the UI
// contains a non-swipable button. To leave some overlap between
// consecutive screenshots (so no content is missed), each swipe ends a
// bit lower than the very top.
function scrollDownOneStep() {
    var startY = deviceHeight * 0.5;
    var endY = deviceHeight * 0.225;
    swipe(middleX, startY, middleX, endY, 800);
    // Wait for the scroll/animation to settle
    sleep(2000);
}

// Function to scroll down by (approximately) a full screen height.
// Since each swipe from the middle only covers a portion of the screen,
// we do two swipes to advance close to a full screen height, while the
// reduced per-swipe distance leaves overlap so nothing is skipped.
function scrollDownFullScreen() {
    scrollDownOneStep();
    scrollDownOneStep();
}

// 请求截图
if (!requestScreenCapture()) {
    toast("请求截图失败");
    exit();
}

sleep(1000);


// Stop once scrolling no longer changes the report beyond the tolerance above.
// Keep a maximum in case animations prevent consecutive captures from matching.
var MAX_SCREENSHOTS = 200;
var previousSample = null;

for (var i = 0; i < MAX_SCREENSHOTS; i++) {
    var screenshot = images.captureScreen();
    try {
        var sampleStarted = new Date().getTime();
        var sample = sampleReport(screenshot);
        var comparisonStarted = new Date().getTime();
        var matched = reportsMatch(previousSample, sample);
        var comparisonFinished = new Date().getTime();
        console.log("Report timing: sampling " + (comparisonStarted - sampleStarted) +
            " ms, comparison " + (comparisonFinished - comparisonStarted) + " ms");

        if (matched) {
            console.log("Reached the bottom of the battle report after " + i + " screenshots");
            break;
        }

        saveScreenshot(screenshot);
        previousSample = sample;
    } finally {
        screenshot.recycle();
    }

    if (i === MAX_SCREENSHOTS - 1) {
        console.log("Stopped after reaching the maximum of " + MAX_SCREENSHOTS + " screenshots");
        break;
    }

    scrollDownFullScreen();
    sleep(3000);
}
