(() => {
    "use strict";

    // ----- CONFIG -----
    const COLS = 5;
    const ROWS = 3;

    const SYMBOLS = ["🍒", "🍋", "🔔", "⭐", "🍀", "💎"];
    // Higher weight = more common
    const WEIGHTS = { "🍒": 30, "🍋": 28, "🔔": 22, "⭐": 16, "🍀": 10, "💎": 6 };
    // Payouts are multipliers of bet-per-line, for N in-a-row from the left.
    const PAY = {
        "💎": { 3: 50, 4: 200, 5: 1000 },
        "🍀": { 3: 20, 4: 100, 5: 400 },
        "⭐": { 3: 10, 4: 40, 5: 200 },
        "🔔": { 3: 6, 4: 20, 5: 100 },
        "🍋": { 3: 4, 4: 12, 5: 60 },
        "🍒": { 3: 2, 4: 6, 5: 30 }
    };

    // 10 classic 5x3 paylines. Each entry is a list of row indices (0..2)
    const LINES = [
        [1, 1, 1, 1, 1], // 1 middle
        [0, 0, 0, 0, 0], // 2 top
        [2, 2, 2, 2, 2], // 3 bottom
        [0, 1, 2, 1, 0], // 4 V
        [2, 1, 0, 1, 2], // 5 ^ (inverted V)
        [0, 0, 1, 0, 0], // 6 dip center
        [2, 2, 1, 2, 2], // 7 peak center
        [1, 0, 1, 2, 1], // 8 W-ish
        [1, 2, 1, 0, 1], // 9 M-ish
        [0, 1, 1, 1, 2]  // 10 gentle slope
    ];

    // ----- DOM -----
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
    const reelsEl = $("#reels");
    const balEl = $("#balance");
    const linesEl = $("#lines");
    const betEl = $("#bet");
    const spinBtn = $("#spin");
    const maxBtn = $("#max");
    const msgEl = $("#message");
    const previewEl = $("#linesPreview");

    // ----- STATE -----
    let balance = 100.00;
    let spinning = false;

    // Persist (optional)
    try {
        const saved = localStorage.getItem("neon-slots-balance");
        if (saved) balance = Math.max(0, parseFloat(saved) || balance);
    } catch (_) { }

    function updateBalanceUI() {
        balEl.textContent = `$${balance.toFixed(2)}`;
    }

    // ----- RNG -----
    const weightedBag = (() => {
        const bag = [];
        for (const sym of SYMBOLS) {
            const w = WEIGHTS[sym] ?? 1;
            for (let i = 0; i < w; i++) bag.push(sym);
        }
        return bag;
    })();

    function randSym() {
        return weightedBag[Math.floor(Math.random() * weightedBag.length)];
    }

    function makeGrid() {
        // grid[col][row]
        const grid = Array.from({ length: COLS }, () =>
            Array.from({ length: ROWS }, () => randSym())
        );
        return grid;
    }

    // ----- RENDER -----
    function initReels() {
        reelsEl.innerHTML = "";
        // Create 15 cells in a 5-column CSS grid
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
        // Expect grid[col][row]
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
        // highlight cells belonging to given line; if uptoCount given, only from leftmost uptoCount
        const pattern = LINES[lineIdx];
        for (let c = 0; c < Math.min(COLS, uptoCount); c++) {
            const r = pattern[c];
            const el = reelsEl.querySelector(`.cell[data-col="${c}"][data-row="${r}"]`);
            if (el) el.classList.add("win");
        }
    }

    // ----- EVAL -----
    function evaluate(grid, activeLines, betPerLine) {
        const wins = [];
        let totalWin = 0;

        for (let i = 0; i < activeLines; i++) {
            const pattern = LINES[i];
            const first = grid[0][pattern[0]];
            // Count contiguous from left
            let count = 1;
            for (let c = 1; c < COLS; c++) {
                if (grid[c][pattern[c]] === first) count++;
                else break;
            }
            if (count >= 3) {
                const payout = (PAY[first]?.[count] || 0) * betPerLine;
                if (payout > 0) {
                    totalWin += payout;
                    wins.push({ line: i + 1, symbol: first, count, payout });
                }
            }
        }
        return { totalWin, wins };
    }

    // ----- PREVIEW -----
    function buildLinesPreview() {
        previewEl.innerHTML = "";
        // 10 rows * 5 columns of dots
        for (let i = 0; i < LINES.length; i++) {
            const pattern = LINES[i];
            for (let c = 0; c < COLS; c++) {
                const dot = document.createElement("div");
                dot.className = "dot2";
                dot.dataset.line = String(i + 1);
                dot.dataset.col = String(c);
                // Mark path row index for this column
                dot.dataset.path = pattern[c].toString();
                previewEl.appendChild(dot);
            }
        }
        updateLinesPreview();
    }

    function updateLinesPreview() {
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

    // ----- SPIN FLOW -----
    function setMessage(text, type = "") {
        msgEl.textContent = text || "";
        msgEl.className = "message" + (type ? " " + type : "");
    }

    function spinOnce() {
        if (spinning) return;
        const lines = parseInt(linesEl.value, 10);
        const betPerLine = parseFloat(betEl.value);
        const totalBet = lines * betPerLine;

        if (totalBet <= 0) {
            setMessage("Select a valid bet.", "warn");
            return;
        }
        if (totalBet > balance) {
            setMessage("Insufficient balance for that bet.", "warn");
            return;
        }

        spinning = true;
        spinBtn.disabled = true;
        maxBtn.disabled = true;
        linesEl.disabled = true;
        betEl.disabled = true;
        clearWins();
        setMessage("");

        balance -= totalBet;
        updateBalanceUI();

        // "Spin" — generate next grid and animate a tiny bounce
        const next = makeGrid();
        setGrid(next);

        // Tiny bounce animation
        reelsEl.animate(
            [{ transform: "translateY(0px)" }, { transform: "translateY(8px)" }, { transform: "translateY(0px)" }],
            { duration: 380, easing: "cubic-bezier(.2,.8,.2,1)" }
        );

        // Evaluate and show results a beat later so the mini animation feels nicer
        setTimeout(() => {
            const { totalWin, wins } = evaluate(next, lines, betPerLine);

            if (wins.length) {
                for (const w of wins) {
                    highlightLineCells(w.line - 1, w.count);
                }
            }

            if (totalWin > 0) {
                balance += totalWin;
                updateBalanceUI();
                const parts = wins.map(w => `${w.symbol} x${w.count} (L${w.line}) = $${w.payout.toFixed(2)}`);
                setMessage(`You won $${totalWin.toFixed(2)}! ` + parts.join(" • "), "win");
            } else {
                setMessage("No win. Try again!", "muted");
            }

            try { localStorage.setItem("neon-slots-balance", String(balance)); } catch (_) { }

            spinning = false;
            spinBtn.disabled = false;
            maxBtn.disabled = false;
            linesEl.disabled = false;
            betEl.disabled = false;
        }, 420);
    }

    // ----- EVENTS -----
    spinBtn.addEventListener("click", spinOnce);
    maxBtn.addEventListener("click", () => {
        // Set to max lines and highest bet option
        const options = Array.from(betEl.querySelectorAll("option")).map(o => parseFloat(o.value));
        const maxBet = Math.max(...options);
        betEl.value = String(maxBet);
        // lines are listed 10..1 in HTML; pick highest numeric
        const lineVals = Array.from(linesEl.querySelectorAll("option")).map(o => parseInt(o.value || o.textContent, 10)).filter(Number.isFinite);
        linesEl.value = String(Math.max(...lineVals));
        updateLinesPreview();
    });

    linesEl.addEventListener("change", updateLinesPreview);

    document.addEventListener("keydown", (e) => {
        if (e.code === "Space") {
            e.preventDefault();
            spinOnce();
        }
    });

    // ----- INIT -----
    updateBalanceUI();
    initReels();
    buildLinesPreview();
    setMessage("Tip: press Space to spin.", "muted");

})();
