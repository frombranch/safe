// Scroll animations for sections (Reveal effect)
function reveal() {
    var reveals = document.querySelectorAll(".reveal");
    for (var i = 0; i < reveals.length; i++) {
        var windowHeight = window.innerHeight;
        var elementTop = reveals[i].getBoundingClientRect().top;
        var elementVisible = 100;

        if (elementTop < windowHeight - elementVisible) {
            reveals[i].classList.add("active");
        }
    }
}
window.addEventListener("scroll", reveal);
reveal(); // Trigger initially

// Header scroll effect
window.addEventListener("scroll", () => {
    const header = document.querySelector(".header");
    if (window.scrollY > 50) {
        header.classList.add("scrolled");
    } else {
        header.classList.add("scrolled"); // Actually, the design keeps it white, let's keep shadows on scroll
        if (window.scrollY === 0) {
            header.classList.remove("scrolled");
        }
    }
});


// Go Top Button
document.getElementById('goTop').addEventListener('click', () => {
    window.scrollTo({
        top: 0,
        behavior: 'smooth'
    });
});

// Number Counter Animation
let counted = false;
function animateNumbers() {
    const counter = document.querySelector('.count-up');
    if (!counter) return;

    const target = +counter.getAttribute('data-target');
    const position = counter.getBoundingClientRect().top;

    // Only animate if element is in view and hasn't been animated yet
    if (position < window.innerHeight && !counted) {
        counted = true;

        let count = 0;
        const speed = 200; // time in ms
        const increment = target / speed;

        const updateCount = () => {
            count += increment;
            if (count < target) {
                counter.innerText = Math.ceil(count).toLocaleString();
                setTimeout(updateCount, 10);
            } else {
                counter.innerText = target.toLocaleString();
            }
        };
        updateCount();
    }
}

window.addEventListener('scroll', animateNumbers);

// Initialize Chart.js when scrolling to Section 3
let chartInitialized = false;
function initChart() {
    const canvas = document.getElementById('accidentChart');
    if (!canvas) return;

    const position = canvas.getBoundingClientRect().top;
    if (position < window.innerHeight - 50 && !chartInitialized) {
        chartInitialized = true;

        const ctx = canvas.getContext('2d');
        new Chart(ctx, {
            type: 'bar', // Mixing line/bar
            data: {
                labels: ['2022', '2023', '2024', '2025'],
                datasets: [
                    {
                        type: 'line',
                        label: '추세선',
                        data: [1000, 2100, 3200, 4300],
                        borderColor: '#ff4d4d',
                        borderWidth: 2,
                        tension: 0.4,
                        pointBackgroundColor: '#ff4d4d',
                        pointRadius: 4
                    },
                    {
                        type: 'bar',
                        label: '건수',
                        data: [1090, 2190, 3270, 4321],
                        backgroundColor: '#4b8df8',
                        borderRadius: 4,
                        maxBarThickness: 40
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: {
                    padding: {
                        bottom: 30
                    }
                },
                animation: {
                    duration: 2000,
                    easing: 'easeOutQuart'
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        display: false // Hide y axis to match design
                    },
                    x: {
                        grid: {
                            display: false
                        },
                        ticks: {
                            font: {
                                size: 14,
                                weight: 'bold'
                            },
                            color: '#666'
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    }
                }
            }
        });
    }
}

window.addEventListener('scroll', initChart);
