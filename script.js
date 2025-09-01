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

    const LINES = [
        [1, 1, 1, 1, 1],
        [0, 0, 0, 0, 0],
        [2, 2, 2, 2, 2],
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
    const betEl = $("#bet");
    const spinBtn = $("#spin");
    const maxBtn = $("#max");
    const msgEl = $("#message");
    const previewEl = $("#linesPreview");
    const denomEl = $("#denom");
    const totalBetEl = $("#totalBet");

    // Credit controls
    const creditStepEl = $("#creditStep");
    const creditUpBtn = $("#creditUp");
    const creditDownBtn = $("#creditDown");

    // ----- STATE -----
    let balance = 100.00;
    let spinning = false;
    let creditStep = 1.00;
    let denomination = 0.25;

    // spin/stop machinery
    let rollInterval = null;
    let spinTimer = null;
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
        if (!msgEl) return;

        let main = document.getElementById("messageMain");
        if (!main) {
            main = document.createElement("div");
            main.id = "messageMain";
            msgEl.textContent = "";
            msgEl.appendChild(main);
        }

        main.textContent = text || "";
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

        const next = makeGrid();

        rollInterval = setInterval(() => {
            setGrid(makeGrid());
        }, 80);

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

        const { totalWin, wins } = evaluate(finalGrid, lines, betPerLineCredits);

        if (wins.length) {
            for (const w of wins) highlightLineCells(w.line - 1, w.count);
        }

        const totalWinCurrency = totalWin * denomination;
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

    // Build the 3x5 preview grid dots and paint current selection
    function buildLinesPreview() {
        if (!previewEl) return;
        previewEl.innerHTML = "";
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const dot = document.createElement("div");
                dot.className = "dot2";
                dot.dataset.row = String(r);
                dot.dataset.col = String(c);
                previewEl.appendChild(dot);
            }
        }
        updateLinesPreview();
    }

    // Highlight the selected number of lines with green dots
    function updateLinesPreview() {
        if (!previewEl || !linesEl) return;
        const dots = Array.from(previewEl.querySelectorAll(".dot2"));
        dots.forEach(d => d.classList.remove("active", "path"));
        dots.forEach(d => d.classList.add("active"));

        const activeLines = Math.min(parseInt(linesEl.value, 10) || 0, LINES.length);
        for (let i = 0; i < activeLines; i++) {
            const pattern = LINES[i];
            for (let c = 0; c < COLS; c++) {
                const r = pattern[c];
                const dot = previewEl.querySelector(`.dot2[data-row="${r}"][data-col="${c}"]`);
                if (dot) dot.classList.add("path");
            }
        }
    }

    // Basic balance/validation check used by startSpin()
    function canAffordSpin(totalBetCurrency) {
        if (!(totalBetCurrency > 0)) {
            setMessage("Pick at least 1 line and a positive bet.", "muted");
            return false;
        }
        if (balance < totalBetCurrency) {
            setMessage(`Insufficient credit for $${totalBetCurrency.toFixed(2)} spin.`, "muted");
            return false;
        }
        return true;
    }

    // ----- EVENTS -----
    if (spinBtn) spinBtn.addEventListener("click", startSpin);

    if (maxBtn) maxBtn.addEventListener("click", () => {
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
        buildLinesPreview();
        updateTotalBetUI();
    });

    if (betEl) betEl.addEventListener("change", updateTotalBetUI);

    // Denomination Selector
    if (denomEl) {
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

    // Credit Controls
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

    // INFO BUTTON / POPUP
    const btn = document.getElementById("payInfo");
    const pop = document.getElementById("payInfoPopup");

    if (btn && pop) {
        // Toggle popup
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const hidden = pop.hasAttribute("hidden");
            if (hidden) {
                pop.removeAttribute("hidden");
                btn.setAttribute("aria-expanded", "true");
            } else {
                pop.setAttribute("hidden", "");
                btn.setAttribute("aria-expanded", "false");
            }
        });
        // Close when clicking outside
        document.addEventListener("click", (e) => {
            if (!pop.hasAttribute("hidden") && e.target !== btn && !pop.contains(e.target)) {
                pop.setAttribute("hidden", "");
                btn.setAttribute("aria-expanded", "false");
            }
        });
        // Close with Escape
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && !pop.hasAttribute("hidden")) {
                pop.setAttribute("hidden", "");
                btn.setAttribute("aria-expanded", "false");
                btn.focus();
            }
        });
    }

    // SECONDARY TIP
    function appendSecondaryTip(text) {
        if (!msgEl) return;

        let tip2 = document.getElementById("message2");
        if (!tip2) {
            tip2 = document.createElement("div");
            tip2.id = "message2";
            tip2.className = "muted";
            msgEl.appendChild(tip2);
        }
        tip2.textContent = text;
    }

    // INIT
    updateBalanceUI();
    initReels();
    buildLinesPreview();
    updateTotalBetUI();
    setMessage("TIP: press space or enter/return to spin; press again to stop.", "muted");
    appendSecondaryTip("GOOD LUCK!");

})();
