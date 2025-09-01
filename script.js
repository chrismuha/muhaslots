(() => {
    "use strict";

    // ----- CONFIG -----
    const COLS = 5;
    const ROWS = 3;

    const SYMBOLS = ["🍒", "🍋", "🔔", "⭐", "🍀", "💎"];
    const WEIGHTS = { "🍒": 30, "🍋": 28, "🔔": 22, "⭐": 16, "🍀": 10, "💎": 6 };
    const PAY = {
        "💎": { 3: 50, 4: 200, 5: 1000 },
        "🍀": { 3: 20, 4: 100, 5: 400 },
        "⭐": { 3: 10, 4: 40, 5: 200 },
        "🔔": { 3: 6, 4: 20, 5: 100 },
        "🍋": { 3: 4, 4: 12, 5: 60 },
        "🍒": { 3: 2, 4: 6, 5: 30 }
    };

    // 10 paylines (index 0..9 => lines 1..10)
    const LINES = [
        [1, 1, 1, 1, 1], // middle
        [0, 0, 0, 0, 0], // top
        [2, 2, 2, 2, 2], // bottom
        [0, 1, 2, 1, 0],
        [2, 1, 0, 1, 2],
        [0, 0, 1, 0, 0],
        [2, 2, 1, 2, 2],
        [1, 0, 1, 2, 1],
        [1, 2, 1, 0, 1],
        [0, 1, 1, 1, 2]
    ];

    // ----- DOM HELPERS -----
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

    // ----- DOM -----
    const reelsEl = $("#reels");
    const balEl = $("#balance");
    const linesEl = $("#lines");
    const betEl = $("#bet");                 // bet per line in CREDITS (1,2,5,…)
    const spinBtn = $("#spin");
    const maxBtn = $("#max");
    const msgEl = $("#message");
    const previewEl = $("#linesPreview");
    const denomEl = $("#denom");             // denomination ($ per credit) selector
    const totalBetEl = $("#totalBet");       // live total bet readout in $

    // Credit controls (already in HTML)
    const creditStepEl = $("#creditStep");
    const creditUpBtn = $("#creditUp");
    const creditDownBtn = $("#creditDown");

    // ----- STATE -----
    let balance = 100.00;   // stored in currency ($)
    let spinning = false;
    let creditStep = 1.00;  // add/remove currency ($) via ▲/▼ or buttons
    let denomination = 0.25; // $ per credit (must match HTML default if present)

    // spin/stop machinery
    let rollInterval = null;   // setInterval for rolling animation
    let spinTimer = null;      // setTimeout to auto-finalize spin if not stopped manually
    const SPIN_DURATION_MS = 1200;

    // Load persisted values
    try {
        const saved = localStorage.getItem("neon-slots-balance");
        if (saved) balance = Math.max(0, parseFloat(saved) || balance);

        const savedStep = localStorage.getItem("neon-slots-credit-step");
        if (savedStep) creditStep = Math.max(0, parseFloat(savedStep)) || 1;

        const savedDenom = localStorage.getItem("neon-slots-denom");
        if (savedDenom) {
            const d = parseFloat(savedDenom);
            if (Number.isFinite(d) && d > 0) denomination = d;
        }
    } catch { }

    // ----- UI HELPERS -----
    function setMessage(text, type = "") {
        msgEl.textContent = text || "";
        msgEl.className = "message" + (type ? " " + type : "");
    }

    function updateBalanceUI() {
        if (balEl) balEl.textContent = `$${balance.toFixed(2)}`;
    }

    function updateTotalBetUI() {
        if (!totalBetEl || !linesEl || !betEl) return;
        const lines = parseInt(linesEl.value, 10) || 0;
        const betPerLineCredits = parseFloat(betEl.value) || 0;
        const totalBetCurrency = lines * betPerLineCredits * denomination; // $ cost
        totalBetEl.textContent = `$${totalBetCurrency.toFixed(2)}`;
    }

    function saveBalance() {
        try { localStorage.setItem("neon-slots-balance", String(balance)); } catch { }
    }

    function saveDenomination() {
        try { localStorage.setItem("neon-slots-denom", String(denomination)); } catch { }
    }

    function adjustBalance(deltaCurrency) {
        balance = Math.max(0, balance + deltaCurrency);
        updateBalanceUI();
        saveBalance();
        setMessage(deltaCurrency >= 0
            ? `Added $${Math.abs(deltaCurrency).toFixed(2)} to credit.`
            : `Removed $${Math.abs(deltaCurrency).toFixed(2)} from credit.`, "muted");
    }

    // ----- RNG & GRID -----
    const weightedBag = (() => {
        const bag = [];
        for (const sym of SYMBOLS) {
            const w = WEIGHTS[sym] ?? 1;
            for (let i = 0; i < w; i++) bag.push(sym);
        }
        return bag;
    })();

    const randSym = () => weightedBag[Math.floor(Math.random() * weightedBag.length)];

    function makeGrid() {
        return Array.from({ length: COLS }, () =>
            Array.from({ length: ROWS }, () => randSym())
        );
    }

    function initReels() {
        reelsEl.innerHTML = "";
        // layout is row-major in DOM for simple CSS grid; we address via data-* attributes
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const cell = document.createElement("div");
                cell.className = "cell";
                cell.dataset.col = String(c);
                cell.dataset.row = String(r);
                cell.textContent = randSym();
                reelsEl.appendChild(cell);
            }
        }
    }

    function setGrid(grid) {
        for (let c = 0; c < COLS; c++) {
            for (let r = 0; r < ROWS; r++) {
                const el = reelsEl.querySelector(`.cell[data-col="${c}"][data-row="${r}"]`);
                if (el) el.textContent = grid[c][r];
            }
        }
    }

    function clearWins() {
        $$(".cell.win", reelsEl).forEach(el => el.classList.remove("win"));
    }

    function highlightLineCells(lineIdx, uptoCount = 5) {
        const pattern = LINES[lineIdx];
        for (let c = 0; c < Math.min(COLS, uptoCount); c++) {
            const r = pattern[c];
            const el = reelsEl.querySelector(`.cell[data-col="${c}"][data-row="${r}"]`);
            if (el) el.classList.add("win");
        }
    }

    // ----- EVALUATION -----
    // Returns { totalWin, wins }, where values are in CREDITS
    function evaluate(grid, activeLines, betPerLineCredits) {
        const wins = [];
        let totalWin = 0;

        for (let i = 0; i < activeLines; i++) {
            const pattern = LINES[i];
            const first = grid[0][pattern[0]];
            let count = 1;
            for (let c = 1; c < COLS; c++) {
                if (grid[c][pattern[c]] === first) count++;
                else break;
            }
            if (count >= 3) {
                const payoutCredits = (PAY[first]?.[count] || 0) * betPerLineCredits;
                if (payoutCredits > 0) {
                    totalWin += payoutCredits;
                    wins.push({ line: i + 1, symbol: first, count, payout: payoutCredits });
                }
            }
        }
        return { totalWin, wins };
    }

    // ----- LINES PREVIEW -----
    function buildLinesPreview() {
        if (!previewEl) return;
        previewEl.innerHTML = "";
        for (let i = 0; i < LINES.length; i++) {
            for (let c = 0; c < COLS; c++) {
                const dot = document.createElement("div");
                dot.className = "dot2";
                dot.dataset.line = String(i + 1);
                dot.dataset.col = String(c);
                dot.dataset.path = LINES[i][c].toString();
                previewEl.appendChild(dot);
            }
        }
        updateLinesPreview();
    }

    function updateLinesPreview() {
        if (!previewEl) return;
        const active = parseInt(linesEl.value, 10);
        const dots = $$(".dot2", previewEl);
        for (const dot of dots) {
            const line = parseInt(dot.dataset.line, 10);
            const col = parseInt(dot.dataset.col, 10);
            const isActive = line <= active;
            const pathRow = parseInt(dot.dataset.path, 10);
            const isPath = isActive && LINES[line - 1][col] === pathRow;
            if (isPath) {
                dot.style.background = "var(--accent2)";
                dot.style.boxShadow = "0 0 0 1px rgba(255,255,255,.12), 0 0 10px var(--accent2)";
                dot.style.opacity = "1";
            } else {
                dot.style.background = "linear-gradient(180deg, #1e2a4f, #0e1526)";
                dot.style.boxShadow = "inset 0 0 0 1px rgba(255,255,255,.06)";
                dot.style.opacity = isActive ? ".45" : ".2";
            }
        }
    }

    // ----- SPIN / STOP (keyboard toggled) -----
    function canAffordSpin(totalBetCurrency) {
        if (!Number.isFinite(totalBetCurrency) || totalBetCurrency <= 0) {
            setMessage("Select a valid bet.", "muted");
            return false;
        }
        if (totalBetCurrency > balance) {
            setMessage("Insufficient balance for that bet.", "muted");
            return false;
        }
        return true;
    }

    function startSpin() {
        if (spinning) return;

        const lines = parseInt(linesEl.value, 10);
        const betPerLineCredits = parseFloat(betEl.value);
        const totalBetCurrency = lines * betPerLineCredits * denomination;

        if (!canAffordSpin(totalBetCurrency)) return;

        clearWins();
        setMessage("");

        balance -= totalBetCurrency; // deduct in $
        updateBalanceUI();
        saveBalance();
        updateTotalBetUI();

        spinning = true;
        spinBtn.disabled = true;
        maxBtn.disabled = true;
        linesEl.disabled = true;
        betEl.disabled = true;
        if (denomEl) denomEl.disabled = true;

        // Precompute the final outcome
        const next = makeGrid();

        // Rolling animation: keep showing random grids until finalized/stopped
        rollInterval = setInterval(() => {
            setGrid(makeGrid());
        }, 80);

        // Auto-finalize after a duration if not manually stopped
        spinTimer = setTimeout(() => finalizeSpin(next, lines, betPerLineCredits), SPIN_DURATION_MS);
    }

    function stopSpinEarly() {
        if (!spinning) return;
        const lines = parseInt(linesEl.value, 10);
        const betPerLineCredits = parseFloat(betEl.value);

        if (spinTimer) { clearTimeout(spinTimer); spinTimer = null; }
        finalizeSpin(makeGrid(), lines, betPerLineCredits);
    }

    function finalizeSpin(finalGrid, lines, betPerLineCredits) {
        if (rollInterval) {
            clearInterval(rollInterval);
            rollInterval = null;
        }
        if (spinTimer) {
            clearTimeout(spinTimer);
            spinTimer = null;
        }

        setGrid(finalGrid);

        const { totalWin, wins } = evaluate(finalGrid, lines, betPerLineCredits); // credits

        if (wins.length) {
            for (const w of wins) highlightLineCells(w.line - 1, w.count);
        }

        const totalWinCurrency = totalWin * denomination; // convert to $
        if (totalWinCurrency > 0) {
            balance += totalWinCurrency;
            updateBalanceUI();
            const parts = wins.map(w => `${w.symbol} x${w.count} (L${w.line}) = $${(w.payout * denomination).toFixed(2)}`);
            setMessage(`You won $${totalWinCurrency.toFixed(2)} — ${parts.join(" • ")}`, "win");
        } else {
            setMessage("No win. Try again!", "muted");
        }

        saveBalance();

        spinning = false;
        spinBtn.disabled = false;
        maxBtn.disabled = false;
        linesEl.disabled = false;
        betEl.disabled = false;
        if (denomEl) denomEl.disabled = false;

        updateTotalBetUI();
    }

    // ----- EVENTS -----
    if (spinBtn) spinBtn.addEventListener("click", startSpin);

    if (maxBtn) maxBtn.addEventListener("click", () => {
        // set to max of available options
        const betOptions = Array.from(betEl.querySelectorAll("option")).map(o => parseFloat(o.value));
        const maxBet = Math.max(...betOptions);
        betEl.value = String(maxBet);

        const lineOptions = Array.from(linesEl.querySelectorAll("option"))
            .map(o => parseInt(o.value || o.textContent, 10))
            .filter(Number.isFinite);
        linesEl.value = String(Math.max(...lineOptions));

        updateLinesPreview();
        updateTotalBetUI();
        setMessage("Max lines & bet selected.", "muted");
    });

    if (linesEl) linesEl.addEventListener("change", () => {
        updateLinesPreview();
        updateTotalBetUI();
    });

    if (betEl) betEl.addEventListener("change", updateTotalBetUI);

    // Denomination selector
    if (denomEl) {
        // If HTML has preset, sync it; else set the control to state
        const htmlVal = parseFloat(denomEl.value);
        if (Number.isFinite(htmlVal) && htmlVal > 0) denomination = htmlVal;
        else denomEl.value = String(denomination.toFixed(2));

        denomEl.addEventListener("change", () => {
            const v = parseFloat(denomEl.value);
            if (Number.isFinite(v) && v > 0) {
                denomination = v;
                saveDenomination();
                setMessage(`Denomination set to $${denomination.toFixed(2)} per credit.`, "muted");
                updateTotalBetUI();
            } else {
                setMessage("Invalid denomination.", "muted");
                denomEl.value = String(denomination.toFixed(2));
            }
        });
    }

    // Credit controls
    if (creditStepEl) {
        creditStepEl.value = creditStep.toFixed(2);
        creditStepEl.addEventListener("input", () => {
            const v = Math.max(0, parseFloat(creditStepEl.value));
            creditStep = isNaN(v) ? 0 : v;
            try { localStorage.setItem("neon-slots-credit-step", String(creditStep)); } catch { }
        });
    }
    if (creditUpBtn) creditUpBtn.addEventListener("click", () => adjustBalance(creditStep));
    if (creditDownBtn) creditDownBtn.addEventListener("click", () => adjustBalance(-creditStep));

    // KEYBOARD: Space/Enter toggle spin or stop; Up/Down adjust credit
    document.addEventListener("keydown", (e) => {
        const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
        const typing = tag === "input" || tag === "select" || tag === "textarea" || (e.target && e.target.isContentEditable);
        if (typing) return;

        if (e.code === "Space" || e.code === "Enter") {
            e.preventDefault();
            if (spinning) stopSpinEarly();
            else startSpin();
        } else if (e.code === "ArrowUp") {
            e.preventDefault();
            adjustBalance(creditStep);
        } else if (e.code === "ArrowDown") {
            e.preventDefault();
            adjustBalance(-creditStep);
        }
    });

    // ----- INIT -----
    updateBalanceUI();
    initReels();
    buildLinesPreview();
    updateTotalBetUI();
    setMessage("Tip: press Space or Enter to spin; press again to stop.", "muted");

})();
