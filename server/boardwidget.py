"""
Interactive board widget: repertoire tree browser + PGN stepper.

Serves as an MCP resource. Query parameters select mode and configure behavior.
HTML template uses CDN-hosted chess.js + chessboard.js; no build step needed.
"""

BOARD_WIDGET_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Chess Board Widget</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/chessboardjs@1.0.0/dist/chessboard-1.0.0.min.css">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background: #f5f5f5;
            padding: 20px;
            line-height: 1.6;
            color: #333;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 8px;
            padding: 20px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }

        h1 {
            margin-bottom: 20px;
            font-size: 24px;
        }

        .mode-selector {
            margin-bottom: 20px;
            display: flex;
            gap: 10px;
        }

        .mode-selector button {
            padding: 8px 16px;
            border: 2px solid #ddd;
            background: white;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.2s;
        }

        .mode-selector button.active {
            border-color: #1976d2;
            background: #1976d2;
            color: white;
        }

        .mode-selector button:hover:not(.active) {
            border-color: #999;
        }

        .content {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
        }

        .board-panel {
            display: flex;
            flex-direction: column;
            align-items: center;
        }

        #board {
            width: 100%;
            max-width: 500px;
            margin: 0 auto;
        }

        .board-controls {
            margin-top: 20px;
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
            justify-content: center;
        }

        .board-controls button {
            padding: 10px 16px;
            border: 1px solid #ddd;
            background: white;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            transition: background 0.2s;
        }

        .board-controls button:hover {
            background: #f0f0f0;
        }

        .board-controls button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .info-panel {
            display: flex;
            flex-direction: column;
            gap: 15px;
        }

        .move-list {
            background: #f9f9f9;
            border: 1px solid #ddd;
            border-radius: 4px;
            padding: 10px;
            max-height: 400px;
            overflow-y: auto;
            font-family: monospace;
            font-size: 13px;
        }

        .move-list .move {
            padding: 4px 8px;
            border-radius: 3px;
            cursor: pointer;
            transition: background 0.1s;
            display: inline-block;
            margin: 2px;
        }

        .move-list .move:hover {
            background: #e0e0e0;
        }

        .move-list .move.current {
            background: #1976d2;
            color: white;
        }

        .evaluation {
            background: #f9f9f9;
            border: 1px solid #ddd;
            border-radius: 4px;
            padding: 12px;
        }

        .eval-bar {
            height: 30px;
            background: #ddd;
            border-radius: 4px;
            overflow: hidden;
            margin: 8px 0;
            position: relative;
        }

        .eval-white {
            height: 100%;
            background: white;
            transition: width 0.2s;
            border-right: 1px solid #ccc;
        }

        .eval-text {
            font-family: monospace;
            font-size: 12px;
            margin-top: 8px;
            word-break: break-all;
        }

        .pgn-input {
            width: 100%;
            height: 120px;
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-family: monospace;
            font-size: 12px;
            resize: vertical;
        }

        .pgn-controls {
            display: flex;
            gap: 10px;
        }

        .pgn-controls button {
            flex: 1;
            padding: 10px;
            border: 1px solid #ddd;
            background: white;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            transition: background 0.2s;
        }

        .pgn-controls button:hover {
            background: #f0f0f0;
        }

        .pgn-controls button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .fen-display {
            background: #f9f9f9;
            border: 1px solid #ddd;
            border-radius: 4px;
            padding: 10px;
            font-family: monospace;
            font-size: 11px;
            word-break: break-all;
            margin: 10px 0;
        }

        .error {
            background: #ffebee;
            color: #c62828;
            padding: 10px;
            border-radius: 4px;
            border: 1px solid #ef5350;
        }

        .success {
            background: #e8f5e9;
            color: #2e7d32;
            padding: 10px;
            border-radius: 4px;
            border: 1px solid #4caf50;
        }

        @media (max-width: 900px) {
            .content {
                grid-template-columns: 1fr;
            }

            .info-panel {
                order: -1;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>♟ Chess Board Widget</h1>

        <div class="mode-selector">
            <button class="mode-btn" data-mode="pgn">PGN Stepper</button>
            <button class="mode-btn" data-mode="repertoire">Repertoire Browser</button>
        </div>

        <div class="content">
            <!-- Board Section -->
            <div class="board-panel">
                <div id="board" style="width: 400px; height: 400px;"></div>
                <div class="board-controls">
                    <button id="prevBtn" title="Previous move (←)">← Prev</button>
                    <button id="nextBtn" title="Next move (→)">Next →</button>
                    <button id="resetBtn" title="Reset to start">Reset</button>
                    <button id="analyzeBtn" title="Analyze current position">Analyze</button>
                </div>
            </div>

            <!-- Info Section -->
            <div class="info-panel">
                <!-- PGN Mode -->
                <div id="pgn-mode" style="display: none;">
                    <h2>PGN Stepper</h2>
                    <textarea id="pgnInput" class="pgn-input" placeholder="Paste PGN here (e.g., 1. e4 e5 2. Nf3 Nc6...)"></textarea>
                    <div class="pgn-controls">
                        <button id="loadPgnBtn">Load PGN</button>
                        <button id="clearPgnBtn">Clear</button>
                    </div>
                    <div id="pgn-message"></div>
                </div>

                <!-- Repertoire Mode -->
                <div id="repertoire-mode" style="display: none;">
                    <h2>Repertoire Browser</h2>
                    <p>Load a repertoire with <code>load_repertoire</code> tool, then open this widget with the repertoire_id.</p>
                    <div id="repertoire-moves" class="move-list">
                        <div style="color: #999;">No repertoire loaded</div>
                    </div>
                </div>

                <!-- Common: FEN and Evaluation -->
                <div>
                    <h3>Position</h3>
                    <div class="fen-display" id="fenDisplay">rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1</div>
                </div>

                <div id="eval-section" style="display: none;">
                    <h3>Evaluation</h3>
                    <div class="evaluation">
                        <div class="eval-bar">
                            <div class="eval-white" id="evalBar" style="width: 50%;"></div>
                        </div>
                        <div class="eval-text" id="evalText">No evaluation yet</div>
                    </div>
                </div>

                <div id="message-area"></div>
            </div>
        </div>
    </div>

    <!-- Chess.js from CDN (move validation) -->
    <script src="https://cdn.jsdelivr.net/npm/chess.js@1.0.0-beta.8/dist/chess.js"></script>
    <!-- Chessboard.js from CDN (rendering + drag) -->
    <script src="https://cdn.jsdelivr.net/npm/chessboardjs@1.0.0/dist/chessboard-1.0.0.min.js"></script>

    <script>
        // Global state
        let game = new Chess();
        let board = null;
        let currentMode = 'pgn';
        let moveHistory = [];
        let currentMoveIndex = -1;

        // Initialize board visualization
        function initBoard() {
            const config = {
                position: 'start',
                draggable: true,
                dropOffBoard: 'snapback',
                onDragStart: onDragStart,
                onDrop: onDrop,
                onSnapEnd: onSnapEnd,
                pieceTheme: 'https://chessboardjs.com/img/chesspieces/standard/{piece}.png'
            };
            board = Chessboard('board', config);
            updateDisplay();
        }

        function onDragStart(source, piece, position, orientation) {
            if (game.isGameOver()) return false;
            if ((game.turn() === 'w' && piece.search(/^b/) !== -1) ||
                (game.turn() === 'b' && piece.search(/^w/) !== -1)) {
                return false;
            }
            return true;
        }

        function onDrop(source, target) {
            const move = game.move({ from: source, to: target, promotion: 'q' });
            if (move === null) return 'snapback';

            moveHistory = moveHistory.slice(0, currentMoveIndex + 1);
            moveHistory.push(move.san);
            currentMoveIndex = moveHistory.length - 1;
            updateDisplay();
        }

        function onSnapEnd() {
            board.position(game.fen());
        }

        function updateDisplay() {
            board.position(game.fen());
            document.getElementById('fenDisplay').textContent = game.fen();
            updateMoveList();
        }

        function updateMoveList() {
            const moves = moveHistory.map((m, i) =>
                `<span class="move ${i === currentMoveIndex ? 'current' : ''}" data-index="${i}">${m}</span>`
            ).join(' ');

            if (currentMode === 'pgn') {
                // For PGN mode, show move list
                const movesDiv = document.getElementById('pgn-mode');
                const existing = movesDiv.querySelector('.move-list');
                if (!existing) {
                    const div = document.createElement('div');
                    div.className = 'move-list';
                    div.id = 'moveList';
                    movesDiv.appendChild(div);
                }
                document.getElementById('moveList').innerHTML = moves || '<span style="color: #999;">No moves yet</span>';
            }
        }

        function makeMove(sanMove) {
            const result = game.move(sanMove, { sloppy: true });
            if (result) {
                moveHistory = moveHistory.slice(0, currentMoveIndex + 1);
                moveHistory.push(result.san);
                currentMoveIndex = moveHistory.length - 1;
                updateDisplay();
                return true;
            }
            return false;
        }

        function resetBoard() {
            game = new Chess();
            moveHistory = [];
            currentMoveIndex = -1;
            updateDisplay();
            clearMessage();
        }

        function previousMove() {
            if (currentMoveIndex > 0) {
                currentMoveIndex--;
                game = new Chess();
                for (let i = 0; i <= currentMoveIndex; i++) {
                    game.move(moveHistory[i], { sloppy: true });
                }
                updateDisplay();
            }
        }

        function nextMove() {
            if (currentMoveIndex < moveHistory.length - 1) {
                currentMoveIndex++;
                game.move(moveHistory[currentMoveIndex], { sloppy: true });
                updateDisplay();
            }
        }

        function loadPgnFromText() {
            const pgnText = document.getElementById('pgnInput').value.trim();
            if (!pgnText) {
                showMessage('Please enter a PGN', 'error');
                return;
            }

            try {
                game = new Chess();
                const gameMoves = pgnText.split(/\\s+/).filter(m => /^[a-hKQRBN0-9=+#x-]+/.test(m));

                for (const move of gameMoves) {
                    const result = game.move(move, { sloppy: true });
                    if (result) {
                        moveHistory.push(result.san);
                    } else if (!move.match(/^\\d+\\.|^[0-1]\\//)) {
                        throw new Error(`Invalid move: ${move}`);
                    }
                }

                currentMoveIndex = moveHistory.length - 1;
                updateDisplay();
                showMessage(`Loaded ${moveHistory.length} moves`, 'success');
            } catch (e) {
                showMessage(`Error loading PGN: ${e.message}`, 'error');
            }
        }

        function analyzePosition() {
            const fen = game.fen();
            document.getElementById('eval-section').style.display = 'block';
            showMessage('Evaluate position via tool...', 'info');
            // In a real MCP client, this would call mcp.call_tool('evaluate_position', {fen, depth: 18})
            // For now, show placeholder
            document.getElementById('evalText').textContent = `FEN: ${fen}\\n(Tool call would happen in real MCP context)`;
        }

        function showMessage(text, type = 'info') {
            const area = document.getElementById('message-area');
            area.innerHTML = `<div class="${type}">${text}</div>`;
            setTimeout(() => { area.innerHTML = ''; }, 5000);
        }

        function clearMessage() {
            document.getElementById('message-area').innerHTML = '';
        }

        function switchMode(mode) {
            currentMode = mode;
            document.querySelectorAll('.mode-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.mode === mode);
            });
            document.getElementById('pgn-mode').style.display = mode === 'pgn' ? 'block' : 'none';
            document.getElementById('repertoire-mode').style.display = mode === 'repertoire' ? 'block' : 'none';
            clearMessage();
        }

        // Event listeners
        document.addEventListener('DOMContentLoaded', () => {
            initBoard();
            switchMode('pgn');

            document.querySelectorAll('.mode-btn').forEach(btn => {
                btn.addEventListener('click', () => switchMode(btn.dataset.mode));
            });

            document.getElementById('prevBtn').addEventListener('click', previousMove);
            document.getElementById('nextBtn').addEventListener('click', nextMove);
            document.getElementById('resetBtn').addEventListener('click', resetBoard);
            document.getElementById('analyzeBtn').addEventListener('click', analyzePosition);
            document.getElementById('loadPgnBtn').addEventListener('click', loadPgnFromText);
            document.getElementById('clearPgnBtn').addEventListener('click', () => {
                document.getElementById('pgnInput').value = '';
                resetBoard();
            });

            // Keyboard controls
            document.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowLeft') previousMove();
                if (e.key === 'ArrowRight') nextMove();
            });

            // Move list click handler
            document.addEventListener('click', (e) => {
                if (e.target.classList.contains('move')) {
                    const idx = parseInt(e.target.dataset.index);
                    if (idx !== undefined) {
                        currentMoveIndex = idx;
                        game = new Chess();
                        for (let i = 0; i <= idx; i++) {
                            game.move(moveHistory[i], { sloppy: true });
                        }
                        updateDisplay();
                    }
                }
            });
        });
    </script>
</body>
</html>
"""
