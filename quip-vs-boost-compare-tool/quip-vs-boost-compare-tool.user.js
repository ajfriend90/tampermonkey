// ==UserScript==
// @name         Quip vs Boost Compare Tool
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Load exported CSVs of Quip and Boost and display Asset IDs for discrepencies
// @author       ajfriend
// @match        *://*.quip-amazon.com/*
// @match        *://*.boost.aws.a2z.com/platform*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    let quipAssets = new Set();
    let boostAssets = new Set();
    let quipStatusMap = new Map();

    function createButton() {
        if (document.getElementById("csv-tools-container")) return;

        let container = document.createElement("div");
        container.id = "csv-tools-container";
        container.style.position = "fixed";
        container.style.top = "10px";
        container.style.right = "10px";
        container.style.zIndex = "9999";
        container.style.padding = "5px";
        container.style.background = "rgba(255, 255, 255, 0.9)";
        container.style.border = "1px solid #ddd";
        container.style.borderRadius = "50%";
        container.style.boxShadow = "0 4px 8px rgba(0,0,0,0.1)";
        container.style.width = "40px";
        container.style.height = "40px";
        container.style.display = "flex";
        container.style.justifyContent = "center";
        container.style.alignItems = "center";
        container.style.transition = "width 0.3s ease, border-radius 0.3s ease";

        // Icon
        let icon = document.createElement("div");
        icon.textContent = "⚙️";
        icon.style.cursor = "pointer";
        icon.style.fontSize = "20px";
        icon.style.userSelect = "none";
        container.appendChild(icon);

        // Load CSVs Button
        let loadButton = document.createElement("button");
        loadButton.textContent = "🔄 Compare CSVs";
        loadButton.style.padding = "6px 10px";
        loadButton.style.background = "#3498db";
        loadButton.style.color = "white";
        loadButton.style.border = "none";
        loadButton.style.borderRadius = "6px";
        loadButton.style.cursor = "pointer";
        loadButton.style.fontWeight = "bold";
        loadButton.style.display = "none";

        // Instructions Button
        let instructionsButton = document.createElement("button");
        instructionsButton.textContent = "ℹ️ How to Use";
        instructionsButton.style.padding = "6px 10px";
        instructionsButton.style.background = "#95a5a6";
        instructionsButton.style.color = "white";
        instructionsButton.style.border = "none";
        instructionsButton.style.borderRadius = "6px";
        instructionsButton.style.cursor = "pointer";
        instructionsButton.style.display = "none";

        container.appendChild(loadButton);
        container.appendChild(instructionsButton);

        // Hover behavior
        container.addEventListener('mouseenter', () => {
            container.style.width = "220px";
            container.style.borderRadius = "8px";
            icon.style.display = "none";
            loadButton.style.display = "block";
            instructionsButton.style.display = "block";
            container.style.gap = "5px";
        });

        container.addEventListener('mouseleave', () => {
            container.style.width = "40px";
            container.style.borderRadius = "50%";
            icon.style.display = "block";
            loadButton.style.display = "none";
            instructionsButton.style.display = "none";
            container.style.gap = "0px";
        });

        loadButton.onclick = startCSVSelection;
        instructionsButton.onclick = showInstructions;

        document.body.appendChild(container);
    }

    function startCSVSelection() {
        alert("📂 Please select the **Quip CSV file**");

        let quipInput = document.createElement("input");
        quipInput.type = "file";
        quipInput.accept = ".csv";
        quipInput.onchange = function (e) {
            let reader = new FileReader();
            reader.onload = handleQuipCSV;
            reader.readAsText(e.target.files[0]);
        };
        quipInput.click();
    }

    function handleQuipCSV(event) {
        let lines = event.target.result.split("\n").map(line => line.split(","));
        let headers = lines[1].map(h => h.replace(/["']/g, "").trim()); // Clean headers

        let quipIndex = headers.indexOf("Asset");

        if (quipIndex === -1) {
            alert("⚠ Asset ID column **not found** in Quip CSV!\nCheck column names.");
            return;
        }

        // Find index of "Status" column
        let statusIndex = headers.indexOf("Status");

        quipStatusMap = new Map();

        lines.slice(2).forEach(row => {
            let asset = row[quipIndex]?.trim().replace(/^"|"$/g, "");
            let status = row[statusIndex]?.trim().toLowerCase();

                if (asset) {
                    // Convert from scientific notation if needed
                    if (/^\d+(\.\d+)?e\+\d+$/i.test(asset)) {
                        asset = Number(asset).toFixed(0);
                    }

                    if (/^\d+$/.test(asset)) {
                        quipAssets.add(asset);
                        quipStatusMap.set(asset, (status || "").trim().toLowerCase());
                    }
                }
        });

        // Extract Asset IDs
        quipAssets = new Set(
            lines.slice(1) // Skip headers
                .map(row => row[quipIndex]?.trim())
                .filter(id => id && /^\d+$/.test(id)) // Only numeric IDs
        );

        alert("✅ Quip CSV loaded! Now select **Boost CSV**.");

        let boostInput = document.createElement("input");
        boostInput.type = "file";
        boostInput.accept = ".csv";
        boostInput.onchange = function (e) {
            let reader = new FileReader();
            reader.onload = handleBoostCSV;
            reader.readAsText(e.target.files[0]);
        };
        boostInput.click();
    }

    function handleBoostCSV(event) {
        let lines = event.target.result.split("\n").map(line => line.split(","));

        if (lines.length < 2) {
            alert("⚠ Boost CSV is empty or unreadable!");
            return;
        }

        let headers = lines[0].map(h => h.replace(/["']/g, "").trim()); // Use row 1 for headers

        let boostIndex = headers.findIndex(h => h.trim().toLowerCase() === "asset id");

        if (boostIndex === -1) {
            console.error("❌ 'Asset id' column NOT found! Boost Headers:", headers);
            alert("⚠ Asset ID column not found in Boost CSV! Check column names.");
            return;
        }

        // Extract Asset IDs, skipping headers
        boostAssets = new Set();

        lines.slice(1).forEach((row, i) => { // Start at row 1 (skip headers)
            if (row.length > boostIndex) {
                let asset = row[boostIndex].replace(/["']/g, "").trim(); // Remove extra quotes
                if (/^\d+$/.test(asset)) { // Only numeric IDs
                    boostAssets.add(asset);
                } else {
                    console.warn(`⚠ Skipping non-numeric asset at row ${i + 1}:`, asset);
                }
            } else {
                console.warn(`⚠ Skipping row ${i + 1} - Not enough columns:`, row);
            }
        });

        alert("✅ Boost CSV loaded! Now displaying assets...");

        compareResults();
    }

    function compareResults() {
        // Assets in Quip but not in Boost, excluding 'Handed-Off' or 'NML Handed Off'
        let onlyInQuip = [...quipAssets].filter(asset =>
                                                !boostAssets.has(asset) &&
                                                !["handed-off", "nml handed off"].includes(quipStatusMap.get(asset))
                                               );

        // Assets in Boost but not in Quip
        let onlyInBoost = [...boostAssets].filter(asset => !quipAssets.has(asset));

        // Prepare results for display
        let resultText = `✅ Total Matching Asset IDs: ${quipAssets.size - onlyInQuip.length}\n\n`;

        resultText += "❌ Only in Quip (after filtering 'Handed-Off'):\n";
        resultText += onlyInQuip.length > 0 ? onlyInQuip.join("\n") : "None";
        resultText += "\n\n";

        resultText += "❌ Only in Boost:\n";
        resultText += onlyInBoost.length > 0 ? onlyInBoost.join("\n") : "None";

        displayResults(resultText);
    }

	function displayResults(resultText) {
		let resultWindow = window.open("", "CSV Comparison Results", "width=800,height=600");
		resultWindow.document.write(`
			<html>
			<head>
				<title>CSV Comparison Results</title>
				<style>
					body {
						font-family: Arial, sans-serif;
						padding: 15px;
						line-height: 1.5;
						white-space: pre-wrap;
					}
					button {
						margin-top: 20px;
						padding: 10px 15px;
						background-color: #3498db;
						color: #fff;
						border: none;
						border-radius: 5px;
						cursor: pointer;
					}
				</style>
			</head>
			<body>
				<pre>${resultText}</pre>
				<button onclick="window.close()">Close</button>
			</body>
			</html>
		`);
		resultWindow.document.close();
	}

    function showInstructions() {
        let instructionText = `
        📖 How to Use Quip vs Boost CSV Comparator:
        1️⃣ First, export both Quip and Boost WFs to CSV files.
        2️⃣ For Quip, go to Rack Hand-Off tab, Template in top left, Export, CSV.
        3️⃣ For Boost, go to Work Requests, set filters for AZ CMH51, OSU61, Status: In Progress, Rack usage: Non-network, and an appropriate Arrival Date range, then Export CSV in top right.
        4️⃣ Click "🔄 Compare CSVs" to start comparison.
        5️⃣ Select the CSV exported from Quip when prompted.
        6️⃣ Next, select the CSV exported from Boost when prompted.
        7️⃣ The script will compare the CSVs automatically and show the results in a pop-up window.
        ⚠️ Make sure:
        - Quip CSV has columns: "Asset" and "Status".
        - Boost CSV has column: "Asset id".
        ✅ Assets only in Quip (but not marked as "Handed-Off") and assets only in Boost will be clearly listed.
        You can copy/paste results from the pop-up window for searching in the webpage.
        `;

        let instructionsWindow = window.open("", "Instructions", "width=600,height=500");
        instructionsWindow.document.write(`
        <html>
        <head>
            <title>Instructions</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    padding: 20px;
                    line-height: 1.6;
                    white-space: pre-wrap;
                }
                button {
                    margin-top: 20px;
                    padding: 8px 15px;
                    background-color: #95a5a6;
                    color: white;
                    border: none;
                    border-radius: 5px;
                    cursor: pointer;
                }
            </style>
        </head>
        <body>
            <pre>${instructionText}</pre>
            <button onclick="window.close()">Close</button>
        </body>
        </html>
    `);
        instructionsWindow.document.close();
    }

    // Inject the button when page loads
    createButton();
})();
