const deviceWidth = device.width;
const deviceHeight = device.height;
const middleX = deviceWidth / 2;

// Function to save screenshot
function saveScreenshot() {
    // Capture screenshot
    var img = images.captureScreen();

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

    // Release image memory
    img.recycle();

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


// Scroll down a full screen height and take a screenshot, repeat
for (var i = 0; i < 50; i++) {
    saveScreenshot();
    scrollDownFullScreen();
    sleep(3000);
}
