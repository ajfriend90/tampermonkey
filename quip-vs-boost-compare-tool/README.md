# Quip ↔ Boost Compare Tool

This Tampermonkey script compares asset data between Quip CSV exports and a Boost CSV export, highlighting differences. It was created for a daily workflow at an AWS data center to ensure no discrepencies between Quip and Boost records for server rack deliveries. 

---

## ✨ Features
- Upload one or more Quip CSVs (merges into one dataset)
- Upload a Boost CSV
- Filter out assets marked as *handed off* (case and punctuation insensitive)
- Show assets **only in Quip**, **only in Boost**, and **in both**
- Click an asset to copy it to clipboard (with strike-through to track progress)
- Small popup results window for side-by-side investigation

---

## 📥 Installation
1. Install the [Tampermonkey browser extension](https://www.tampermonkey.net/).
2. [Click here to install](https://raw.githubusercontent.com/ajfriend90/tampermonkey/main/quip-vs-boost-compare-tool/quip-vs-boost-compare-tool.user.js) the latest version.
3. Tampermonkey will prompt you to confirm—click **Install**.

---

## 🛠 Usage
1. From the Tampermonkey menu, select **Compare CSVs**.
2. Upload one or more Quip CSV exports.
3. Click **All Quip CSVs Uploaded** when done.
4. Upload the Boost CSV export.
5. Review results in the popup window.

**Tip:** Keep the popup open while investigating discrepancies so you can copy individual asset IDs.

---

## 📄 Version History
- **2.0** — Multi-Quip upload support, clickable asset copy, improved UI
- **1.0** — Initial release
