document.addEventListener("DOMContentLoaded", function() {
    setTimeout(() => {
        let logo = document.querySelector(".logo");
        let intro = document.querySelector(".intro");
        let loginPage = document.querySelector(".loginPage");

        // Apply slide-up animation
        logo.classList.add("slide-up");

        // Wait for animation to finish before hiding intro and showing loginPage
        setTimeout(() => {
            intro.style.display = "none";  // Hide intro
            loginPage.style.removeProperty("display"); // Remove inline display:none
            setTimeout(() => {
                loginPage.style.opacity = "1"; // Fade in loginPage
            }, 50);
        }, 1000); // Matches the slide-up animation duration
    }, 5000); // Wait 5 seconds before starting transition
});

document.querySelector(".createAccount").addEventListener("click", function () {
    let loginPage = document.querySelector(".loginPage");
    let numberPage = document.querySelector("#number");

    // Slide out .loginPage
    loginPage.classList.add("slide-out");

    // Wait for the slide-out animation to finish before showing #number
    setTimeout(() => {
        loginPage.style.display = "none"; // Hide login page
        numberPage.style.display = "block"; // Make #number visible
        setTimeout(() => {
            numberPage.classList.add("show"); // Trigger slide-in animation
        }, 10); // Small delay for transition effect
    }, 500); // Same duration as the CSS transition
});


document.addEventListener("DOMContentLoaded", function () {
    let body = document.body;
    let loginPage = document.querySelector(".loginPage");

    // Function to apply loginPage's background to body
    function applyBackground() {
        if (window.getComputedStyle(loginPage).display === "block") {
            let bgColor = window.getComputedStyle(loginPage).backgroundColor;
            body.style.backgroundColor = bgColor; // Apply background
        }
    }

    // Check on page load (if loginPage is initially block)
    applyBackground();

    // Example: Show loginPage and update body background on button click
    document.querySelector(".createAccount").addEventListener("click", function () {
        loginPage.style.display = "block";
        body.classList.add("login-active"); // Apply class to body
        applyBackground(); // Update body color
    });
});