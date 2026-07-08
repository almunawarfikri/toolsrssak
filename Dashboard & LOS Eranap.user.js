// ==UserScript==
// @name         Dashboard & LOS Eranap (Combined) RS SA Karawaci
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  Dashboard TKMKB + LOS RS + LOS BPJS + Auto 200 + CPPT Diagnosa Viewer
// @author       Fikri
// @updateURL    https://raw.githubusercontent.com/almunawarfikri/toolsrssak/main/Dashboard%20&%20LOS%20Eranap.obfuscated.user.js
// @downloadURL  https://raw.githubusercontent.com/almunawarfikri/toolsrssak/main/Dashboard%20&%20LOS%20Eranap.obfuscated.user.js
// @match        http://192.168.10.6/smartplus/erm_ranap*
// @match        http://klik38.com/smartplus/erm_ranap*
// @match        https://klik38.com/smartplus/erm_ranap*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      klik38.com
// ==/UserScript==

(function () {
    'use strict';

    /* ================= 1. AUTO 200 & UI PREP ================= */

    function initAuto100() {
        // Hide sidebar automatically
        const toggle = document.querySelector(".sidebartoggler");
        if (toggle) toggle.click();

        // Set 200 entries
        const interval = setInterval(() => {
            let select = document.querySelector("select[name$='_length']");
            if (select) {
                if (!select.querySelector("option[value='200']")) {
                    let opt = document.createElement("option");
                    opt.value = "200";
                    opt.text = "200";
                    select.appendChild(opt);
                }
                select.value = "200";
                select.dispatchEvent(new Event('change'));
                console.log("SmartPlus Eranap: Entries diset ke 200");
                clearInterval(interval);
            }
        }, 500);
    }

    /* ================= 2. CACHE & CONSTANTS ================= */

    const CACHE_KEY_LOS = "smartplus_cache_all_eranap_v2";
    const CACHE_KEY_DX = "smartplus_dx_cache_v3";
    const CACHE_KEY_TARIF = "smartplus_tarif_cache_v1";
    const MAX_PARALLEL = 8; // Optimal untuk fetch 2 sumber berbeda

    let losCache = JSON.parse(localStorage.getItem(CACHE_KEY_LOS) || "{}");
    let dxCache = JSON.parse(localStorage.getItem(CACHE_KEY_DX) || "{}");
    let tarifCache = JSON.parse(localStorage.getItem(CACHE_KEY_TARIF) || "{}");

    function fetchCORS(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                onload: function(res) {
                    if (res.status >= 200 && res.status < 300) {
                        resolve({ text: () => Promise.resolve(res.responseText) });
                    } else {
                        reject(new Error("HTTP " + res.status));
                    }
                },
                onerror: function(err) {
                    reject(err);
                }
            });
        });
    }

    function formatDiagnosa(text) {
        if (!text) return text;
        text = text.replace(/<br\s*\/?>/gi, " ");
        text = text.replace(/\b[A-Z]\d{1,2}(\.\d+)?\s*\|\s*/g, "");
        text = text.replace(/,?\s*UNSPECIFIED/gi, "");
        text = text.replace(/:+/g, "");
        text = text.replace(/;+\s*$/, "");
        let parts = text.split(";").map(p => {
            p = p.trim();
            if (!p) return null;
            return p.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
        }).filter(Boolean);
        return parts.join(" ; ");
    }

    function getIdReg(row) {
        let href = row.getAttribute("data-href");
        if (!href) return null;
        let m = href.match(/([0-9]{4}[A-Z]{2}[0-9]+)/);
        return m ? m[1] : null;
    }

    /* ================= 3. LOS UTILS ================= */

    function parseDate(str) {
        if (!str) return new Date(NaN);
        let d = new Date(str);
        if (!isNaN(d.getTime())) return d;

        let m = str.match(/(\d{2})\s+([a-zA-Z]{3})\s+(\d{4})\s+(\d{2}):(\d{2})/);
        if (m) {
            let months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, mei: 4, jun: 5, jul: 6, aug: 7, agt: 7, sep: 8, oct: 9, okt: 9, nov: 10, dec: 11, des: 11 };
            let month = months[m[2].toLowerCase()];
            if (month !== undefined) return new Date(m[3], month, m[1], m[4], m[5]);
        }

        let clean = str.replace(/[^\d\-\s:]/g, "").trim();
        d = new Date(clean.replace(" ", "T"));
        if (!isNaN(d.getTime())) return d;
        d = new Date(clean);
        if (!isNaN(d.getTime())) return d;
        let parts = clean.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
        if (parts) return new Date(parts[1], parts[2] - 1, parts[3], parts[4], parts[5], parts[6]);
        return new Date(NaN);
    }

    function hitungLOS(tgl) {
        if (!tgl) return { text: "-", hari: 0 };
        let start = parseDate(tgl);
        if (isNaN(start.getTime())) return { text: "-", hari: 0 };
        let diff = new Date() - start;
        if (diff < 0) diff = 0;
        let hari = Math.floor(diff / (1000 * 60 * 60 * 24));
        let jam = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        return { text: `${hari} Hari ${jam} Jam`, hari };
    }

    function hitungLOSBPJS(tgl) {
        if (!tgl) return 0;
        let s = parseDate(tgl);
        if (isNaN(s.getTime())) return 0;
        let n = new Date();
        let sd = new Date(s.getFullYear(), s.getMonth(), s.getDate());
        let nd = new Date(n.getFullYear(), n.getMonth(), n.getDate());
        let diff = Math.floor((nd - sd) / (1000 * 60 * 60 * 24)) + 1;
        return diff > 0 ? diff : 1;
    }

    function ambilWaktuRegistrasi(html) {
        let doc = new DOMParser().parseFromString(html, "text/html");
        let combined = html.match(/(?:Waktu Registrasi|Regdate)\s*[:]\s*([\d\-\s:]{10,20})/i);
        if (combined) return combined[1].trim();
        let labels = ["Waktu Registrasi", "Regdate"];
        for (let label of labels) {
            let el = Array.from(doc.querySelectorAll("label, span, td, div")).find(e => e.innerText.trim().replace(":", "") === label);
            if (el) {
                let next = el.nextElementSibling;
                if (next && /[\d\-\s:]{10,}/.test(next.innerText)) return next.innerText.replace(":", "").trim();
                let parent = el.parentElement;
                if (parent && parent.nextElementSibling) {
                    let v = parent.nextElementSibling.innerText.trim();
                    if (/[\d\-\s:]{10,}/.test(v)) return v.replace(":", "").trim();
                }
            }
        }
        return null;
    }

    function ambilLOSNumeric(text) {
        const hari = text.match(/(\d+)\s*Hari/i);
        const jam = text.match(/(\d+)\s*Jam/i);
        let h = hari ? parseInt(hari[1]) : 0;
        let j = jam ? parseInt(jam[1]) : 0;
        return h + (j / 24);
    }

    /* ================= 4. TABLE STYLING ================= */

    const style = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    
    #dashboardPasien {
        padding: 0 0 12px 0;
        font-family: 'Inter', -apple-system, sans-serif;
        font-size: 13px;
        color: #334155;
    }
    
    body.hide-tarif .tarif-header,
    body.hide-tarif .tarif-cell {
        display: none !important;
    }
    
    .dash-title {
        font-size: 18px; 
        font-weight: 800; 
        color: #1e293b;
        letter-spacing: -0.5px;
        display: flex;
        align-items: center;
    }
    
    .dashboard-grid {
        display: grid;
        grid-template-columns: 1fr 1.3fr 2.2fr;
        gap: 12px;
        margin-bottom: 12px;
        align-items: start;
    }
    
    .stat-card {
        background: #ffffff;
        padding: 12px 14px;
        border-radius: 16px;
        border: none;
        box-shadow: 0 4px 12px rgba(15, 23, 42, 0.04);
        display: flex;
        flex-direction: column;
    }
    
    .stat-label {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #64748b;
        margin-bottom: 6px;
    }
    
    .stat-value {
        font-size: 22px;
        font-weight: 800;
        color: #0f172a;
        line-height: 1;
    }
    
    .indicator {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 10px;
        border-radius: 20px;
        font-size: 11px;
        font-weight: 600;
        white-space: nowrap;
    }
    
    .indicator.hijau { background: #dcfce7; color: #166534; }
    .indicator.orange { background: #fef3c7; color: #92400e; }
    .indicator.merah { background: #fee2e2; color: #991b1b; }
    .indicator.abu { background: #f1f5f9; color: #475569; }
    
    .indicator.chip-kelas { background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; font-weight: 700; }
    .indicator.chip-asuransi { background: #fdf4ff; color: #86198f; border: 1px solid #f8cdea; font-weight: 700; }
    
    .card-ringkasan { border-top: 4px solid #3b82f6; background: linear-gradient(150deg, #ffffff 40%, #eff6ff 100%); border-radius: 12px; }
    .card-kelas { border-top: 4px solid #10b981; background: linear-gradient(150deg, #ffffff 40%, #f0fdf4 100%); border-radius: 12px; }
    .card-asuransi { border-top: 4px solid #f59e0b; background: linear-gradient(150deg, #ffffff 40%, #fffbeb 100%); border-radius: 12px; }
    
    .badge-dokter {
        display: inline-flex;
        align-items: center;
        background: #ffffff;
        padding: 4px 10px;
        border-radius: 20px;
        margin: 2px;
        font-size: 11px;
        font-weight: 600;
        color: #334155;
        border: 1px solid #e2e8f0;
        box-shadow: 0 2px 4px rgba(0,0,0,0.02);
    }
    
    .badge-dokter .count {
        background: #4f46e5;
        color: white;
        padding: 1px 6px;
        border-radius: 10px;
        margin-left: 6px;
        font-size: 10px;
        font-weight: 800;
    }
    
    .bor-pill {
        background: #4f46e5;
        color: white;
        padding: 2px 8px;
        border-radius: 10px;
        font-weight: 800;
        font-size: 11px;
    }
    
    .btn-export {
        background: #10b981;
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        box-shadow: 0 4px 10px rgba(16, 185, 129, 0.3);
        display: flex;
        align-items: center;
        gap: 6px;
        transition: all 0.2s;
    }
    
    .btn-export:hover {
        background: #059669;
        transform: translateY(-1px);
        box-shadow: 0 6px 14px rgba(16, 185, 129, 0.4);
    }
    
    .los-box {
        margin-bottom: 10px;
        background: #ffffff;
        border: none;
        border-radius: 16px;
        overflow: hidden;
        box-shadow: 0 4px 12px rgba(15, 23, 42, 0.04);
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    
    .los-header {
        font-weight: 700;
        cursor: pointer;
        padding: 14px 16px;
        font-size: 14px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: #ffffff;
        color: #1e293b;
        user-select: none;
    }
    
    .toggle-icon {
        transition: transform 0.3s;
        font-size: 16px;
        color: #94a3b8;
    }
    .los-header.open .toggle-icon {
        transform: rotate(180deg);
    }
    
    .los-content {
        max-height: 0;
        opacity: 0;
        overflow: hidden;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    
    .los-content.open {
        max-height: 2000px;
        opacity: 1;
        padding: 0 16px 16px 16px;
    }
    
    .los-item {
        padding: 10px 12px;
        background: #f8fafc;
        border-radius: 12px;
        margin-bottom: 6px;
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
    }
    
    .btn-modal { cursor: pointer; transition: all 0.15s ease; }
    .btn-modal:hover { opacity: 0.85; transform: scale(0.97); }
    .scrollbar-hide::-webkit-scrollbar { width: 4px; }
    .scrollbar-hide::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
    
    @keyframes modalPop { 0% { opacity:0; transform:scale(0.9); } 100% { opacity:1; transform:scale(1); } }
    `;

    document.head.appendChild(Object.assign(document.createElement("style"), { innerHTML: style }));

    /* ================= 5. CORE LOGIC (SETUP COLUMNS & FETCHING) ================= */

    let rsIndex = -1;
    let bpjsIndex = -1;
    let tarifIndex = -1;
    let dxIndex = 6; // default
    let nativeRsIndex = -1;
    let nativeBpjsIndex = -1;

    function getLiveIndices() {
        let table = document.getElementById("myTable");
        if (!table) return null;

        let headers = Array.from(table.querySelectorAll("thead th"));
        let indices = {
            noKamar: 1,
            kamar: 2,
            kelas: 4,
            rmNama: 5,
            rs: -1,
            bpjs: -1,
            tarif: -1,
            dpjp: 7,
            asuransi: 8,
            diagnosa: 6,
            alamat: -1
        };

        headers.forEach((th, i) => {
            let txt = th.innerText.trim();
            let lower = txt.toLowerCase();
            if (th.classList.contains("custom-losrs-header")) {
                indices.rs = i;
            } else if (th.classList.contains("losbpjs-header")) {
                indices.bpjs = i;
            } else if (th.classList.contains("tarif-header")) {
                indices.tarif = i;
            } else if (lower.includes("diagnosa")) {
                indices.diagnosa = i;
            } else if (lower.includes("dokter") || lower.includes("dpjp")) {
                indices.dpjp = i;
            } else if (lower.includes("penjamin") || lower.includes("asuransi") || lower.includes("cara bayar") || lower.includes("sponsor")) {
                indices.asuransi = i;
            } else if (lower.includes("kelas")) {
                indices.kelas = i;
            } else if (lower.includes("kamar") && i === 1) {
                indices.noKamar = i;
            } else if (lower.includes("kamar") || lower.includes("ruang")) {
                indices.kamar = i;
            } else if (lower.includes("pasien") || lower.includes("rm") || lower.includes("nama")) {
                indices.rmNama = i;
            } else if (lower === "alamat") {
                indices.alamat = i;
            }
        });

        return indices;
    }

    function setupColumns() {
        let table = document.getElementById("myTable");
        if (!table) return false;

        let headers = Array.from(table.querySelectorAll("thead th"));
        let alamatIndex = -1;

        // Find native and custom columns
        for (let i = 0; i < headers.length; i++) {
            let txt = headers[i].innerText.trim();
            let isCustomRs = headers[i].classList.contains("custom-losrs-header");
            let isCustomBpjs = headers[i].classList.contains("losbpjs-header");

            if (txt === "LOS RS" && !isCustomRs && nativeRsIndex === -1) nativeRsIndex = i;
            if (txt === "LOS BPJS" && !isCustomBpjs && nativeBpjsIndex === -1) nativeBpjsIndex = i;

            if (isCustomRs) rsIndex = i;
            if (isCustomBpjs) bpjsIndex = i;
            let isCustomTarif = headers[i].classList.contains("tarif-header");
            if (isCustomTarif) tarifIndex = i;

            if (txt.toLowerCase().includes("diagnosa")) dxIndex = i;
            if (txt.toLowerCase() === "alamat") alamatIndex = i;
        }

        // Insert custom columns after Alamat if they don't exist yet
        if (rsIndex === -1 && alamatIndex !== -1) {
            let thRs = document.createElement("th");
            thRs.innerText = "LOS RS";
            thRs.className = "custom-losrs-header text-center";
            headers[alamatIndex].after(thRs);
            
            let thBpjs = document.createElement("th");
            thBpjs.innerText = "LOS BPJS";
            thBpjs.className = "losbpjs-header text-center";
            thRs.after(thBpjs);
            
            let thTarif = document.createElement("th");
            thTarif.innerText = "Tarif RS";
            thTarif.className = "tarif-header text-center";
            thBpjs.after(thTarif);
            
            rsIndex = alamatIndex + 1;
            bpjsIndex = alamatIndex + 2;
            tarifIndex = alamatIndex + 3;
        }

        if (rsIndex === -1) return false;

        // Hide native columns
        if (nativeRsIndex !== -1 && nativeRsIndex !== rsIndex) {
            headers[nativeRsIndex].style.display = "none";
        }
        if (nativeBpjsIndex !== -1 && nativeBpjsIndex !== bpjsIndex) {
            headers[nativeBpjsIndex].style.display = "none";
        }

        return true;
    }

    function warnaCell(cell, hari) {
        cell.style.background = ""; cell.style.color = ""; cell.style.fontWeight = "";
        if (hari >= 5) { cell.style.background = "#d50000"; cell.style.color = "white"; cell.style.fontWeight = "bold"; }
        else if (hari === 4) { cell.style.background = "#ff9800"; cell.style.color = "white"; }
        else if (hari === 3) { cell.style.background = "#4caf50"; cell.style.color = "white"; }
    }

    function tampilkanLOS(tgl, rsCell, bpjsCell) {
        if (!tgl) {
            rsCell.innerText = "-"; rsCell.setAttribute("data-order", 0);
            bpjsCell.innerText = "-"; bpjsCell.setAttribute("data-order", 0);
            return;
        }
        let los = hitungLOS(tgl);
        let losBPJS = hitungLOSBPJS(tgl);
        rsCell.innerText = los.text; rsCell.setAttribute("data-order", los.hari);
        bpjsCell.innerText = losBPJS + " Hari"; bpjsCell.setAttribute("data-order", losBPJS);
        warnaCell(rsCell, los.hari);
    }

    async function prosesBarisParallel(row) {
        let indices = getLiveIndices();
        let currentRsIndex = indices && indices.rs !== -1 ? indices.rs : rsIndex;
        let currentBpjsIndex = indices && indices.bpjs !== -1 ? indices.bpjs : bpjsIndex;
        let currentDxIndex = indices ? indices.diagnosa : dxIndex;

        let cells = Array.from(row.querySelectorAll("td"));
        if (!cells || cells.length < 5) return false;

        let id = getIdReg(row);
        let link = row.querySelector("td:last-child a");

        // Hide native cells
        if (nativeRsIndex !== -1 && cells[nativeRsIndex]) {
            cells[nativeRsIndex].style.display = "none";
        }
        if (nativeBpjsIndex !== -1 && cells[nativeBpjsIndex]) {
            cells[nativeBpjsIndex].style.display = "none";
        }

        // UI Setup for Custom Cells
        let rsCell = row.querySelector(".custom-losrs-cell");
        let bpjsCell = row.querySelector(".losbpjs-cell");
        let tarifCell = row.querySelector(".tarif-cell");
        let currentAlamatIndex = indices && indices.alamat !== -1 ? indices.alamat : -1;

        if (!rsCell || !bpjsCell || !tarifCell) {
            // Find Alamat cell to insert after it
            let alamatCell = currentAlamatIndex !== -1 ? cells[currentAlamatIndex] : null;
            if (alamatCell) {
                if (!rsCell) {
                    rsCell = document.createElement("td");
                    rsCell.className = "custom-losrs-cell text-center";
                    alamatCell.after(rsCell);
                }
                if (!bpjsCell) {
                    bpjsCell = document.createElement("td");
                    bpjsCell.className = "losbpjs-cell text-center";
                    rsCell.after(bpjsCell);
                }
                if (!tarifCell) {
                    tarifCell = document.createElement("td");
                    tarifCell.className = "tarif-cell text-right";
                    bpjsCell.after(tarifCell);
                }
                cells = Array.from(row.querySelectorAll("td"));
            } else {
                return false; // Cannot setup UI without finding Alamat
            }
        }

        let diagCell = cells[currentDxIndex];

        // Cache pre-fill
        let losKey = link ? link.href : null;
        let tgl = losKey ? losCache[losKey]?.tgl : null;

        // Try to extract date from native LOS RS text
        if (!tgl && nativeRsIndex !== -1 && cells[nativeRsIndex]) {
            let text = cells[nativeRsIndex].innerText.trim();
            let m = text.match(/(\d{2}\s+[a-zA-Z]{3}\s+\d{4}\s+\d{2}:\d{2})/);
            if (m) {
                tgl = m[1];
                if (losKey) {
                    losCache[losKey] = { tgl: tgl };
                }
            } else if (text.match(/^\d{4}-\d{2}-\d{2}/)) {
                tgl = text.split("\n")[0].trim();
                if (losKey) {
                    losCache[losKey] = { tgl: tgl };
                }
            }
        }

        let dtReady = !!tgl;
        let dxReady = !!(id && dxCache[id]);
        let tarifReady = !!(id && tarifCache[id]);

        if (dtReady) tampilkanLOS(tgl, rsCell, bpjsCell);
        else { rsCell.innerText = "Loading..."; bpjsCell.innerText = "..."; }

        if (dxReady && diagCell) {
            if (diagCell.innerText !== dxCache[id]) diagCell.innerText = dxCache[id];
        }

        if (tarifReady && tarifCell) {
            if (tarifCell.innerText !== tarifCache[id]) tarifCell.innerText = tarifCache[id];
        } else if (tarifCell) {
            tarifCell.innerText = "Loading...";
        }

        let fetches = [];
        let hasChanges = false;

        // Fetch LOS Date from details if not in cache
        if (!dtReady && losKey) {
            fetches.push(
                Promise.race([
                    fetch(losKey).then(r => r.text()),
                    new Promise((_, r) => setTimeout(() => r("timeout"), 8000))
                ]).then(html => {
                    let d = ambilWaktuRegistrasi(html);
                    if (d) {
                        losCache[losKey] = { tgl: d };
                        tampilkanLOS(d, rsCell, bpjsCell);
                        return true;
                    }
                    tampilkanLOS(null, rsCell, bpjsCell);
                    return false;
                }).catch(() => { tampilkanLOS(null, rsCell, bpjsCell); return false; })
            );
        }

        // Fetch CPPT Diagnosis if not in cache
        if (!dxReady && id) {
            fetches.push(
                Promise.race([
                    fetch(`${window.location.origin}/smartplus/nurse_station/eranap/cppt_viewer/${id}`).then(r => r.text()),
                    new Promise((_, r) => setTimeout(() => r("timeout"), 8000))
                ]).then(html => {
                    let doc = new DOMParser().parseFromString(html, "text/html");
                    let labels = [...doc.querySelectorAll(".col-md-3")];
                    let rawDx = null;
                    for (let label of labels) {
                        if (label.innerText.includes("Diagnosa Medis")) {
                            let dxDiv = label.nextElementSibling;
                            if (dxDiv) { rawDx = dxDiv.innerText.trim(); break; }
                        }
                    }
                    if (rawDx) {
                        let fmt = formatDiagnosa(rawDx);
                        dxCache[id] = fmt;
                        if (diagCell) diagCell.innerText = fmt;
                        return true;
                    }
                    return false;
                }).catch(() => false)
            );
        }

        // Fetch Tarif RS if not in cache
        if (!tarifReady && id) {
            fetches.push(
                Promise.race([
                    fetchCORS(`http://klik38.com:90/pudingv2/admin/updatetarifrscasemix.php?id_reg=${id}`).then(r => r.text()),
                    new Promise((_, r) => setTimeout(() => r("timeout"), 8000))
                ]).then(html => {
                    let m = html.match(/<h8>\s*Total biaya perawatan di E-Puding\s*:\s*(Rp[^<]+)<\/h8>/i) || html.match(/<h8>[^:]+:\s*(Rp[^<]+)<\/h8>/i);
                    if (m && m[1]) {
                        let val = m[1].trim();
                        tarifCache[id] = val;
                        if (tarifCell) tarifCell.innerText = val;
                        return true;
                    } else {
                        tarifCache[id] = "-";
                        if (tarifCell) tarifCell.innerText = "-";
                        return true;
                    }
                }).catch(() => {
                    if (tarifCell) tarifCell.innerText = "Error";
                    return false;
                })
            );
        }

        let results = await Promise.all(fetches);
        if (results.some(r => r)) hasChanges = true;

        return hasChanges;
    }

    async function runFetchQueue() {
        let rows = Array.from(document.querySelectorAll("#myTable tbody tr"));
        if (rows.length === 0) return;

        let index = 0;
        let totalChanges = false;

        async function worker() {
            while (index < rows.length) {
                let row = rows[index++];
                if (row) {
                    let ch = await prosesBarisParallel(row);
                    if (ch) totalChanges = true;
                }
            }
        }

        let pool = [];
        for (let i = 0; i < MAX_PARALLEL; i++) pool.push(worker());
        await Promise.all(pool);

        // Save Cache Only Once After Batch
        if (totalChanges) {
            localStorage.setItem(CACHE_KEY_LOS, JSON.stringify(losCache));
            localStorage.setItem(CACHE_KEY_DX, JSON.stringify(dxCache));
            localStorage.setItem(CACHE_KEY_TARIF, JSON.stringify(tarifCache));
            buatDashboard();
        }
    }

    /* ================= 6. STATISTIK & MODALS ================= */

    const rankMap = {
        "DELUXE": 10, "VIP": 20, "EXECUTIVE": 30, "SVIP": 40, "ICU ISOLASI": 45, "ICU": 50, "HCU": 60,
        "KELAS III": 90, "KELAS 3": 90, "KELAS II": 80, "KELAS 2": 80, "KELAS I": 70, "KELAS 1": 70,
        "ISOLASI": 100, "ODC": 110, "PERINATOLOGI": 120
    };
    const rankKeys = Object.keys(rankMap).sort((a, b) => b.length - a.length);
    const getPrio = (k) => {
        if (!k) return 999;
        let upper = k.toUpperCase().trim();
        let match = rankKeys.find(key => upper.includes(key));
        return match ? rankMap[match] : 999;
    };

    let targetWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    targetWindow.bukaModalPasien = function (title, jsonArr) {
        let arr = JSON.parse(decodeURIComponent(jsonArr));
        arr.sort((a, b) => {
            let prioA = getPrio(a.kelas);
            let prioB = getPrio(b.kelas);
            if (prioA !== prioB) return prioA - prioB;
            let bpjsA = a.asuransi && a.asuransi.toUpperCase().includes("BPJS");
            let bpjsB = b.asuransi && b.asuransi.toUpperCase().includes("BPJS");
            if (bpjsA !== bpjsB) return bpjsA ? 1 : -1;
            return 0;
        });

        let existing = document.getElementById("customModal");
        if (existing) existing.remove();

        const m = document.createElement("div");
        m.id = "customModal";
        m.style.cssText = "position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.5); z-index:99999; display:flex; align-items:center; justify-content:center; backdrop-filter: blur(2px);";
        m.innerHTML = `
            <div style="background:#fff; border-radius:12px; width:90%; max-width:850px; max-height:85vh; display:flex; flex-direction:column; box-shadow: 0 10px 25px rgba(0,0,0,0.2); font-family: Inter, sans-serif; animation: modalPop 0.2s ease-out;">
                <div style="padding:12px 16px; border-bottom:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center; background:#f8fafc; border-radius:12px 12px 0 0;">
                    <h5 style="margin:0; font-weight:700; color:#0f172a; font-size:15px; display:flex; align-items:center; gap:8px;">${title} <span class="indicator hijau" style="padding: 2px 8px; font-size: 11px;">${arr.length} Px</span></h5>
                    <button id="closeModalBtn" style="background:none; border:none; font-size:24px; cursor:pointer; color:#64748b; line-height:1;">&times;</button>
                </div>
                <div style="padding:12px; overflow-y:auto; flex-grow:1;">
                    <table style="width:100%; border-collapse:collapse; font-size:12px;">
                        <thead>
                            <tr style="background:#f1f5f9; text-align:left;">
                                <th style="padding:8px; border:1px solid #e2e8f0; width:30px; text-align:center;">No</th>
                                <th style="padding:8px; border:1px solid #e2e8f0; width:150px;">Data Pasien</th>
                                <th style="padding:8px; border:1px solid #e2e8f0;">Diagnosa CPPT</th>
                                <th style="padding:8px; border:1px solid #e2e8f0; width:120px;">DPJP</th>
                                <th style="padding:8px; border:1px solid #e2e8f0; width:120px;">Kelas & Asuransi</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${arr.map((p, i) => `
                            <tr>
                                <td style="padding:6px 8px; border:1px solid #e2e8f0; text-align:center;">${i + 1}</td>
                                <td style="padding:6px 8px; border:1px solid #e2e8f0;"><b>${p.nama}</b><br><span style="color:#64748b; font-size:10px;">${p.rm}</span><br><span style="color:#10b981; font-size:10px; font-weight:600;">🛏️ ${p.noKamar || '-'} (${p.kamar})</span></td>
                                <td style="padding:6px 8px; border:1px solid #e2e8f0;"><div style="color: #4338ca; font-weight: 500; font-size: 11px; line-height: 1.3;">${p.diagnosa || '-'}</div></td>
                                <td style="padding:6px 8px; border:1px solid #e2e8f0;">${p.dpjp}</td>
                                <td style="padding:6px 8px; border:1px solid #e2e8f0;"><span class="indicator chip-kelas" style="font-size:10px; padding:1px 6px;">${p.kelas}</span><br><div style="margin-top:4px; font-size:10px; color:#475569; font-weight:600;">${p.asuransi}</div></td>
                            </tr>
                            `).join("")}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        document.body.appendChild(m);
        document.getElementById("closeModalBtn").onclick = () => m.remove();
        m.onclick = (e) => { if (e.target === m) m.remove(); };
    };

    function singkatDokter(nama) {
        nama = nama.replace(/\n/g, " ").trim();
        const map = {
            "Agus Hermawan,dr. Sp.OG": "dr. Agus H, Sp.OG",
            "Agung Budi Hartono,dr. Sp.OG": "dr. Agung, Sp.OG",
            "Khalid Mohammad Shidiq,dr. Sp.PD": "dr. Khalid, Sp.PD",
            "Fandy Erlangga,dr. Sp.PD, C.PML, AIFO-K": "dr. Fandy, Sp.PD",
            "Ahmad Sofian,dr. Sp.PD": "dr. Sofian, Sp.PD",
            "Edy Sunarto,dr. Sp.S": "dr. Edy S, Sp.S",
            "Virginia Nuriah Hikmawati,dr. Sp.P": "dr. Virginia, Sp.P",
            "Adjie Pratignyo, dr.Sp.B": "dr. Adjie, Sp.B",
            "Gogor Meisadona, dr. SpN": "dr. Gogor, Sp.S",
            "Winda Rahmah Darman,dr. Sp.N": "dr. Winda R, Sp.S",
            "Rahardi Mokhtar,dr. Sp.A": "dr. Rahardi, Sp.A",
            "Didik Wijayanto,dr. Sp.A": "dr. Didik, Sp.A",
            "Akhmad Isna Nurudinulloh, dr. Sp.JP": "dr. Isna, Sp.JP",
            "Ira Melintira Trinanty,dr. Sp.P": "dr. Ira, Sp.P",
            "Miky Akbar,dr. Sp.A. M.Ked (Ped)": "dr. Miky, Sp.A",
            "Mahruzzaman Naim,dr. Sp.A": "dr. Mahruz, Sp.A",
            "Widyastuti,dr. Sp.A": "dr. Widyastuti, Sp.A",
            "Harry Mahathir Akip,dr. Sp.JP": "dr. Hary, Sp.JP",
            "Kiki Maharani,dr. Sp.PD": "dr. Kiki, Sp.PD",
            "Nasrul Liza,dr. Sp.B.(K)BD": "dr. Nasrul, Sp.B(K)BD",
            "Septiani Hidianingsih,dr. Sp.U": "dr. Septiani, Sp.U",
            "Muchamad Wisuda Riswanto,dr. Sp.B": "dr. Wisuda, Sp.B",
            "Tommie Prasetyo Utomo Wiharto,dr. Sp.U": "dr. Tommie, Sp.U",
            "Muhammad Hafiz Afif,dr. Sp.B": "dr. Hafiz, Sp.B"
        };
        for (let key in map) { if (nama.includes(key)) return map[key]; }
        return nama;
    }

    function getRuangan(cells, kamarIndex) {
        let raw = "";
        let idx = typeof kamarIndex === "number" ? kamarIndex : 2;
        if (cells[idx]) {
            raw = cells[idx].innerText.trim();
        } else {
            const ruangCell = cells.find(c => c.innerText.includes("RPU") || c.innerText.includes("ICU") || c.innerText.includes("HCU") || c.innerText.includes("PICU") || c.innerText.includes("KORIDOR") || c.innerText.includes("ISOLASI"));
            if (!ruangCell) return "";
            raw = ruangCell.innerText.trim();
        }
        return raw.split(/\s+/)[0].toUpperCase().trim();
    }

    /* ================= 7. BUILD DASHBOARD ================= */

    function hitungStatistik() {
        const rows = document.querySelectorAll("#myTable tbody tr");
        let indices = getLiveIndices() || {
            noKamar: 1, kamar: 2, kelas: 4, rmNama: 5, dpjp: 7, asuransi: 8, diagnosa: dxIndex, rs: rsIndex
        };

        let total = rows.length; let sumLOS_RS = 0; let hijau = 0; let los4 = 0; let los5 = 0;
        let dokter = {}; let kelas = {}; let asuransi = {}; let kamarList = {}; let losTinggi = [];

        rows.forEach(row => {
            const cells = Array.from(row.cells);
            if (cells.length < 5) return;

            let rm = ""; let nama = ""; let dpjp = ""; let kelasName = ""; let asuransiName = ""; let noKamar = ""; let kamar = "";
            if (cells[indices.noKamar]) noKamar = cells[indices.noKamar].innerText.trim();
            if (cells[indices.kamar]) kamar = cells[indices.kamar].innerText.trim();
            if (cells[indices.kelas]) kelasName = cells[indices.kelas].innerText.trim();
            if (cells[indices.rmNama]) {
                rm = cells[indices.rmNama].innerText.split("\n").pop().trim();
                nama = cells[indices.rmNama].innerText.split("\n")[0].trim();
            }
            if (cells[indices.dpjp]) dpjp = singkatDokter(cells[indices.dpjp].innerText.split("\n")[0].trim());
            if (cells[indices.asuransi]) asuransiName = cells[indices.asuransi].innerText.trim() || "PRIBADI / UMUM";

            let diagText = "";
            if (cells[indices.diagnosa]) {
                diagText = cells[indices.diagnosa].innerText.trim();
                let regId = getIdReg(row);
                if (regId && dxCache[regId]) diagText = dxCache[regId];
            }

            let pObj = { nama, rm, dpjp, noKamar, kamar, kelas: kelasName, asuransi: asuransiName, diagnosa: diagText };

            if (kelasName) { if (!kelas[kelasName]) kelas[kelasName] = []; kelas[kelasName].push(pObj); }
            if (asuransiName) { if (!asuransi[asuransiName]) asuransi[asuransiName] = []; asuransi[asuransiName].push(pObj); }
            const dokterCell = cells.find(c => /dr\./i.test(c.innerText));
            if (dokterCell) { if (!dokter[dpjp]) dokter[dpjp] = []; dokter[dpjp].push(pObj); }
            if (kamar) { if (!kamarList[kamar]) kamarList[kamar] = []; kamarList[kamar].push(pObj); }

            let losCell = (indices.rs !== -1 && cells[indices.rs]) ? cells[indices.rs] : cells.find(c => /^\s*\d+\s*Hari/i.test(c.innerText));
            if (losCell) {
                let losText = losCell.innerText.trim();
                let los = ambilLOSNumeric(losText);
                sumLOS_RS += los;
                let hari = Math.floor(los);
                if (hari <= 3) hijau++;
                else if (hari === 4) los4++;
                else if (hari >= 5) {
                    los5++;
                    losTinggi.push({ rm, nama, dokter: dpjp, losText, hari, ruang: getRuangan(cells, indices.kamar), diagnosa: diagText });
                }
            }
        });

        // Sorting Arrays
        const sortedKelas = {};
        Object.keys(kelas).sort((a, b) => getPrio(a) - getPrio(b)).forEach(k => { sortedKelas[k] = kelas[k]; });
        const sortedAsuransi = {};
        Object.keys(asuransi).sort((a, b) => asuransi[b].length - asuransi[a].length).forEach(k => { sortedAsuransi[k] = asuransi[k]; });
        losTinggi.sort((a, b) => b.hari - a.hari);

        return { total, hijau, los4, los5, dokter, kamar: kamarList, kelas: sortedKelas, asuransi: sortedAsuransi, losTinggi };
    }

    function eksportCSV() {
        const rows = document.querySelectorAll("#myTable tr");
        let csv = [];
        rows.forEach(r => {
            let cols = r.querySelectorAll("td,th");
            let row = [];
            cols.forEach(c => row.push('"' + c.innerText.replace(/\n/g, " ").trim() + '"'));
            csv.push(row.join(";"));
        });
        let blob = new Blob([csv.join("\n")], { type: "text/csv" });
        let a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "data_pasien_ranap.csv";
        a.click();
    }

    function formatDokter(data) {
        return Object.entries(data).sort((a, b) => b[1].length - a[1].length).map(d => {
            let json = encodeURIComponent(JSON.stringify(d[1])).replace(/'/g, "\\'");
            let title = d[0].replace(/'/g, "\\'");
            return `<div class="badge-dokter btn-modal" onclick="bukaModalPasien('Pasien ${title}', '${json}')" style="cursor:pointer;"><span>${d[0]}</span><span class="count">${d[1].length}</span></div>`;
        }).join("");
    }

    function formatKamar(data) {
        return Object.entries(data).sort((a, b) => b[1].length - a[1].length).map(d => {
            let json = encodeURIComponent(JSON.stringify(d[1])).replace(/'/g, "\\'");
            let title = d[0].replace(/'/g, "\\'");
            return `<div class="badge-dokter btn-modal" onclick="bukaModalPasien('Kamar ${title}', '${json}')" style="cursor:pointer; border-color: #f8cdea; background: #fdf4ff;">
                        <span style="color:#86198f; font-weight:700; padding-left:4px;">🛏️ ${d[0]}</span>
                        <span class="count" style="background:#d946ef;">${d[1].length}</span>
                    </div>`;
        }).join("");
    }

    function buatDashboard() {
        let existing = document.getElementById("dashboardPasien");
        if (existing) existing.remove();

        const d = hitungStatistik();
        const borPercent = ((d.total / 147) * 100).toFixed(1);

        const div = document.createElement("div");
        div.id = "dashboardPasien";

        div.innerHTML = `
        <div style="margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center;">
            <span class="dash-title">📱 Dashboard TKMKB</span>
            <div style="display:flex; gap:12px; align-items:center;">
                <label style="font-size:12px; font-weight:600; cursor:pointer; color:#64748b; display:flex; align-items:center; gap:4px; user-select:none; margin:0;">
                    <input type="checkbox" id="toggleTarif" style="cursor:pointer;" checked> Tampilkan Tarif RS
                </label>
                <button class="btn-export" id="exportCSV">
                    <span>⬇</span> Export CSV
                </button>
            </div>
        </div>
    
        <div class="dashboard-grid">
            <div class="stat-card card-ringkasan" style="justify-content: space-between;">
                <div>
                    <span class="stat-label" style="color: #2563eb;">📊 Ringkasan</span>
                    <div class="stat-value">${d.total} <span style="font-size: 12px; color: #64748b; font-weight: 600;">Pasien</span></div>
                    <div style="display: flex; gap: 4px; margin-top: 10px; flex-wrap: wrap;">
                        <span class="indicator hijau">LOS ≤3: ${d.hijau}</span>
                        <span class="indicator orange">4: ${d.los4}</span>
                        <span class="indicator merah">≥5: ${d.los5}</span>
                    </div>
                </div>
                <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #f1f5f9;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                        <span style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">BOR (Occupancy) - dari 147 Bed</span>
                        <span class="bor-pill" style="font-size: 10px; padding: 1px 6px;">${borPercent}%</span>
                    </div>
                    <div style="height: 6px; background: #f1f5f9; border-radius: 3px; overflow: hidden;">
                        <div style="width: ${borPercent}%; height: 100%; background: linear-gradient(90deg, #6366f1, #8b5cf6); border-radius: 3px;"></div>
                    </div>
                </div>
            </div>
    
            <div class="stat-card card-kelas">
                <span class="stat-label" style="color: #059669;">🏥 Distribusi Kelas</span>
                <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px;">
                    ${Object.entries(d.kelas).map(k => {
            let json = encodeURIComponent(JSON.stringify(k[1])).replace(/'/g, "\\'");
            let title = k[0].replace(/'/g, "\\'");
            return `<span class="indicator chip-kelas btn-modal" onclick="bukaModalPasien('Kelas ${title}', '${json}')" style="box-shadow: 0 1px 2px rgba(0,0,0,0.03); font-size: 11px; padding: 4px 8px;">
                                    ${k[0]}: <b style="margin-left:2px; color:#0f172a">${k[1].length}</b>
                                </span>`;
        }).join("")}
                </div>
            </div>
    
            <div class="stat-card card-asuransi">
                <span class="stat-label" style="color: #d97706; padding-left: 8px;">🛡️ Asuransi</span>
                <div class="scrollbar-hide" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 4px 16px; margin-top: 4px; padding: 0 8px; max-height: 140px; overflow-y: auto;">
                    ${Object.entries(d.asuransi).map(a => {
            let json = encodeURIComponent(JSON.stringify(a[1])).replace(/'/g, "\\'");
            let title = a[0].replace(/'/g, "\\'");
            return `<div class="btn-modal" onclick="bukaModalPasien('Asuransi ${title}', '${json}')" style="display:flex; justify-content:space-between; align-items:center; padding: 4px 0; border-bottom: 1px dashed #fde68a;">
                                    <span style="color:#b45309; font-size:11px; font-weight:700; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; max-width: 85%;" title="${a[0]}">${a[0]}</span>
                                    <span class="indicator chip-asuransi" style="padding: 2px 6px; font-size: 10px;">${a[1].length}</span>
                                </div>`;
        }).join("")}
                </div>
            </div>
        </div>
    
        <!-- Collapsible Kamar -->
        <div class="los-box">
            <div class="los-header" id="toggleKamar" style="background: #fffafa; color: #86198f; border-bottom: 0px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size:16px;">🏢</span> 
                    <span style="font-weight:800;">Distribusi Kamar / Ruang Rawat</span>
                    <span class="indicator" style="background: #fae8ff; color: #a21caf; padding: 1px 6px;">${Object.keys(d.kamar).length} Kamar</span>
                </div>
                <span class="toggle-icon" style="color: #d946ef;">▼</span>
            </div>
            <div id="kamarContent" class="los-content" style="background: #fffafa;">
                <div style="display: flex; flex-wrap: wrap; padding-top: 4px;">
                    ${formatKamar(d.kamar)}
                </div>
            </div>
        </div>
    
        <!-- Collapsible Dokter -->
        <div class="los-box">
            <div class="los-header" id="toggleDokter">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size:16px;">🩺</span> 
                    <span>Distribusi Dokter</span>
                    <span class="indicator abu">${Object.keys(d.dokter).length} Dokter</span>
                </div>
                <span class="toggle-icon">▼</span>
            </div>
            <div id="dokterContent" class="los-content">
                <div style="display: flex; flex-wrap: wrap; padding-top: 4px;">
                    ${formatDokter(d.dokter)}
                </div>
            </div>
        </div>
    
        <!-- Collapsible LOS Tinggi -->
        <div class="los-box" style="border: 1px solid #fee2e2;">
            <div class="los-header" id="toggleLOS" style="background: #fff5f5;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size:16px;">⚠️</span> 
                    <span style="color: #991b1b;">Pasien LOS Tinggi (≥5 Hari)</span>
                    <span class="indicator merah" style="padding: 2px 8px;">${d.losTinggi.length}</span>
                </div>
                <span class="toggle-icon" style="color: #ef4444;">▼</span>
            </div>
            <div id="losContent" class="los-content" style="background: #fff5f5;">
                ${d.losTinggi.map((p, i) => `
                    <div class="los-item" style="background:#ffffff; border:1px solid #fecaca; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                        <div style="display:flex; flex-direction:column; width:100%; gap:4px;">
                            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                                <span style="color: #1e293b; font-weight: 700; font-size: 13px;">${i + 1}. ${p.nama} <span style="font-weight:500; color:#64748b;">(${p.rm})</span></span>
                                <span class="indicator merah" style="font-size: 10px;">⏱ ${p.losText}</span>
                            </div>
                            <div style="display:flex; flex-direction:column; gap:6px; margin-top:2px;">
                                <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
                                    <span class="badge-dokter" style="margin:0; font-size:10px;">${p.dokter}</span>
                                    <span class="indicator abu" style="font-size: 10px;">📍 ${p.ruang}</span>
                                </div>
                                <div style="color: #4338ca; font-weight: 600; font-size: 11px; line-height: 1.4; padding: 6px 8px; background: #e0e7ff; border-radius: 6px; border-left: 3px solid #6366f1;">
                                    ${p.diagnosa}
                                </div>
                            </div>
                        </div>
                    </div>
                `).join("")}
            </div>
        </div>
        `;

        const table = document.querySelector("#myTable");
        if (table) table.parentElement.insertBefore(div, table);

        // Bind events
        document.getElementById("exportCSV")?.addEventListener("click", eksportCSV);
        ["toggleLOS", "toggleDokter", "toggleKamar"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.onclick = function () {
                this.classList.toggle("open");
                this.nextElementSibling.classList.toggle("open");
            }
        });

        // Toggle Tarif RS
        let toggleTarif = document.getElementById("toggleTarif");
        if (toggleTarif) {
            let isHidden = localStorage.getItem("smartplus_hide_tarif") === "true";
            toggleTarif.checked = !isHidden;
            if (isHidden) document.body.classList.add("hide-tarif");
            else document.body.classList.remove("hide-tarif");
            
            toggleTarif.addEventListener("change", function(e) {
                localStorage.setItem("smartplus_hide_tarif", !e.target.checked);
                if (!e.target.checked) document.body.classList.add("hide-tarif");
                else document.body.classList.remove("hide-tarif");
            });
        }
    }

    /* ================= 8. INIT ================= */

    function init() {
        initAuto100();
        setTimeout(async () => {
            let ok = setupColumns();
            if (ok) {
                // Buat dashboard initial kosong / dengan data cache
                buatDashboard();
                // Mulai parallel fetch
                await runFetchQueue();
            }
        }, 3000);
    }

    init();

})();
