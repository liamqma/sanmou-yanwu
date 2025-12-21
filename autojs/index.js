const deviceWidth = device.width;
const deviceHeight = device.height;
const middleX = deviceWidth / 2;
const middleY = deviceHeight / 2;

// Function to go back
function goBack() {
    click(150, 2240);
}

// Function to swipe from middle to end (top)
function swipeToEnd() {
    swipe(middleX, middleY, middleX, 100, 500);
    sleep(5000);
}

// Function to save battle
function saveBattle() {
    // Click on 1st 战报
    click(middleX, 336);

    sleep(5000);

    saveScreenshot();

    goBack();

    sleep(5000);

    // Click on 2st 战报
    click(middleX, 784);

    sleep(5000);

    saveScreenshot();

    goBack();

    sleep(5000);

    // Click on 3st 战报
    click(middleX, 1245);

    sleep(5000);

    saveScreenshot();

    goBack();
}

// Function to process battle at given y coordinate
function processBattle(y) {
    click(middleX, y);
    sleep(5000);
    saveBattle();
    sleep(5000);
    goBack();
    sleep(5000);
}

// Function to process battles in a batch
function processBattles(startY, count) {
    // Battle Y coordinates pattern:
    // Differences: 305, 305, 295 (average ~302 pixels between battles)
    const battleYSpacing = 305; // Approximate spacing between battles
    
    for (var i = 0; i < count; i++) {
        var battleY = startY + battleYSpacing * i;
        processBattle(battleY);
    }
}

// Function to process all battles for a region (first 4, swipe, next 4)
function processRegionBattles() {
    // Process first 4 battles (starting at y=545)
    processBattles(545, 4);
    
    // Swipe to see next battles
    swipeToEnd();
    
    // Process next 4 battles (starting at y=664)
    processBattles(664, 4);
}

// Function to process a region with selector
function processRegion(regionY) {
    // click on region selector
    click(middleX, 200);
    sleep(2000);
    
    // click on region
    click(middleX, regionY);
    sleep(5000);
    
    // Process all battles for this region
    processRegionBattles();
}

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

    var filename = files.join(screenshotsDir, "screenshot_" + timestamp + ".png");

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

//请求截图
if(!requestScreenCapture()){
    toast("请求截图失败");
    exit();
}

sleep(5000);

// Start with the first region (no selector click needed)
processRegionBattles();

// Process regions 2-6
processRegion(400); // 2nd region
processRegion(445); // 3rd region
processRegion(522); // 4th region
processRegion(614); // 5th region
processRegion(697); // 6th region