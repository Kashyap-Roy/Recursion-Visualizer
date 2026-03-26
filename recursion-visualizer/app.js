/* ============================================================
   Recursion Visualizer — app.js
   Core: Editor, Transpilers (Python/Java → JS), Execution, Visualization
   ============================================================ */

// ── Constants ──
const RECURSION_LIMIT = 200;

const EXAMPLES = {
    python: {
        code: `class Solution:
    def helper(self, n):
        if n <= 1:
            return 1
        return n * self.helper(n - 1)
        
    def factorial(self, n):
        return self.helper(n)`,
        call: 'new Solution().factorial(5)'
    },
    java: {
        code: `// JAVA recursive function to
// solve tower of hanoi puzzle
import java.io.*;
import java.math.*;
import java.util.*;

class GFG {
    static void towerOfHanoi(int n, char from_rod,
                             char to_rod, char aux_rod)
    {
        if (n == 0) {
            return;
        }
        towerOfHanoi(n - 1, from_rod, aux_rod, to_rod);
        System.out.println("Move disk " + n + " from rod "
                           + from_rod + " to rod "
                           + to_rod);
        towerOfHanoi(n - 1, aux_rod, to_rod, from_rod);
    }
    
    // Driver code
    public static void main(String args[])
    {
        int N = 2;
        towerOfHanoi(N, 'A', 'C', 'B');
    }
}
// This code is contributed by jyoti369`,
        call: 'main()'
    }
};

// ── State ──
let currentLang = 'python';
let editor = null;
let callTree = null;
let callCounter = 0;
let consoleLines = [];

// ── DOM Refs ──
const $ = id => document.getElementById(id);
const btnPython = $('btnPython');
const btnJava = $('btnJava');
const toggleSlider = $('toggleSlider');
const stepCount = $('stepCount');
const errorBanner = $('errorBanner');
const errorText = $('errorText');
const errorClose = $('errorClose');
const btnRun = $('btnRun');
const btnReset = $('btnReset');
const fnInput = $('fnInput');
const vizPlaceholder = $('vizPlaceholder');
const vizTree = $('vizTree');
const consoleResizer = $('consoleResizer');
const consolePanel = $('consolePanel');
const consoleOutput = $('consoleOutput');
const btnClearConsole = $('btnClearConsole');
const btnCollapseAll = $('btnCollapseAll');
const btnExpandAll = $('btnExpandAll');

// ── Initialize CodeMirror ──
function initEditor() {
    editor = CodeMirror.fromTextArea($('codeEditor'), {
        mode: 'python',
        theme: 'material-darker',
        lineNumbers: true,
        indentUnit: 4,
        tabSize: 4,
        indentWithTabs: false,
        lineWrapping: false,
        matchBrackets: true,
        autoCloseBrackets: true,
        viewportMargin: Infinity
    });
    editor.setValue(EXAMPLES.python.code);
    fnInput.value = EXAMPLES.python.call;
}

// ── Language Toggle ──
function switchLanguage(lang) {
    currentLang = lang;
    if (lang === 'python') {
        btnPython.classList.add('active');
        btnJava.classList.remove('active');
        toggleSlider.classList.remove('java');
        editor.setOption('mode', 'python');
    } else {
        btnJava.classList.add('active');
        btnPython.classList.remove('active');
        toggleSlider.classList.add('java');
        editor.setOption('mode', 'text/x-java');
    }
}

// ── Error Handling ──
function showError(msg) {
    errorText.textContent = msg;
    errorBanner.classList.add('visible');
}
function hideError() {
    errorBanner.classList.remove('visible');
}

function consolePrint(text, isError = false) {
    consoleLines.push({ text, isError });
    const line = document.createElement('div');
    line.className = 'console-line' + (isError ? ' error' : '');
    line.textContent = text;
    consoleOutput.appendChild(line);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
}
function clearConsole() {
    consoleLines = [];
    consoleOutput.innerHTML = '';
}

// ══════════════════════════════════════════════════════════════
//  PYTHON → JS TRANSPILER
// ══════════════════════════════════════════════════════════════

function transpilePython(code) {
    const lines = code.split('\n');
    let jsLines = [];
    let blockStack = [{ indent: -1, type: 'root' }];

    for (let i = 0; i < lines.length; i++) {
        let raw = lines[i];
        let trimmed = raw.trimEnd();
        if (trimmed === '' || trimmed.startsWith('#')) continue;

        let indent = raw.length - raw.trimStart().length;
        let line = trimmed.trim();

        while (blockStack.length > 1 && indent <= blockStack[blockStack.length - 1].indent) {
            blockStack.pop();
            jsLines.push(makeIndent(blockStack.length) + '}');
        }

        let jsIndent = makeIndent(blockStack.length - 1);

        // Flatten class declarations (ignore them)
        let classMatch = line.match(/^class\s+(\w+)(?:\([^)]*\))?\s*:/);
        if (classMatch) {
            // we don't push anything to jsLines, but we record the block so we can un-indent children
            blockStack.push({ indent: indent, type: 'class' });
            continue;
        }

        let defMatch = line.match(/^def\s+(\w+)\s*\(([^)]*)\)\s*:/);
        if (defMatch) {
            let fnName = defMatch[1];
            let params = defMatch[2].replace(/\bself\b,?/g, '').trim();
            if (params.startsWith(',')) params = params.slice(1).trim();
            
            jsLines.push(`${jsIndent}function ${fnName}(${params}) {`);
            blockStack.push({ indent: indent, type: 'function' });
            continue;
        }

        let ifMatch = line.match(/^if\s+(.+):\s*$/);
        if (ifMatch) {
            jsLines.push(`${jsIndent}if (${convertPyExpr(ifMatch[1])}) {`);
            blockStack.push({ indent: indent, type: 'if' });
            continue;
        }
        
        let elifMatch = line.match(/^elif\s+(.+):\s*$/);
        if (elifMatch) {
            let lastClosed = jsLines.pop();
            if (lastClosed && lastClosed.trim() === '}') jsLines.push(`${jsIndent}} else if (${convertPyExpr(elifMatch[1])}) {`);
            else { if(lastClosed) jsLines.push(lastClosed); jsLines.push(`${jsIndent}else if (${convertPyExpr(elifMatch[1])}) {`); }
            blockStack.push({ indent: indent, type: 'elif' });
            continue;
        }

        if (line === 'else:') {
            let lastClosed = jsLines.pop();
            if (lastClosed && lastClosed.trim() === '}') jsLines.push(`${jsIndent}} else {`);
            else { if(lastClosed) jsLines.push(lastClosed); jsLines.push(`${jsIndent}else {`); }
            blockStack.push({ indent: indent, type: 'else' });
            continue;
        }

        let forMatch = line.match(/^for\s+(\w+)\s+in\s+range\((.+)\)\s*:/);
        if (forMatch) {
            let varName = forMatch[1];
            let rangeArgs = forMatch[2].split(',').map(s => s.trim());
            let start = '0', end, step = '1';
            if (rangeArgs.length === 1) { end = rangeArgs[0]; }
            else if (rangeArgs.length === 2) { start = rangeArgs[0]; end = rangeArgs[1]; }
            else { start = rangeArgs[0]; end = rangeArgs[1]; step = rangeArgs[2]; }
            jsLines.push(`${jsIndent}for (let ${varName} = ${start}; ${varName} < ${end}; ${varName} += ${step}) {`);
            blockStack.push({ indent: indent, type: 'for' });
            continue;
        }

        let whileMatch = line.match(/^while\s+(.+):\s*$/);
        if (whileMatch) {
            jsLines.push(`${jsIndent}while (${convertPyExpr(whileMatch[1])}) {`);
            blockStack.push({ indent: indent, type: 'while' });
            continue;
        }

        let retMatch = line.match(/^return\s*(.*)/);
        if (retMatch) {
            let val = retMatch[1].trim();
            if (val === '') jsLines.push(`${jsIndent}return;`);
            else jsLines.push(`${jsIndent}return ${convertPyExpr(val)};`);
            continue;
        }

        let printMatch = line.match(/^print\s*\((.+)\)\s*$/);
        if (printMatch) {
            jsLines.push(`${jsIndent}__print(${convertPyExpr(printMatch[1])});`);
            continue;
        }

        let assignMatch = line.match(/^(\w+)\s*=\s*(.+)$/);
        if (assignMatch) {
            jsLines.push(`${jsIndent}let ${assignMatch[1]} = ${convertPyExpr(assignMatch[2])};`);
            continue;
        }

        let augMatch = line.match(/^(\w+)\s*([\+\-\*\/\%])=\s*(.+)$/);
        if (augMatch) {
            jsLines.push(`${jsIndent}${augMatch[1]} ${augMatch[2]}= ${convertPyExpr(augMatch[3])};`);
            continue;
        }

        jsLines.push(`${jsIndent}${convertPyExpr(line)};`);
    }

    while (blockStack.length > 1) {
        let block = blockStack.pop();
        if (block.type !== 'class') jsLines.push(makeIndent(blockStack.length) + '}');
    }

    return jsLines.join('\n');
}

function convertPyExpr(expr) {
    expr = expr.replace(/\bTrue\b/g, 'true');
    expr = expr.replace(/\bFalse\b/g, 'false');
    expr = expr.replace(/\bNone\b/g, 'null');
    expr = expr.replace(/\band\b/g, '&&');
    expr = expr.replace(/\bor\b/g, '||');
    expr = expr.replace(/\bnot\b/g, '!');
    
    // Flattening: self.method() becomes method()
    expr = expr.replace(/\bself\./g, '');
    
    expr = convertIntegerDivision(expr);
    expr = expr.replace(/\blen\s*\(([^)]+)\)/g, '($1).length');
    expr = expr.replace(/\babs\s*\(([^)]+)\)/g, 'Math.abs($1)');
    expr = expr.replace(/\bmax\s*\(/g, 'Math.max(');
    expr = expr.replace(/\bmin\s*\(/g, 'Math.min(');
    expr = expr.replace(/\*\*/g, '**');
    expr = expr.replace(/(\w+)\[(\w*):(\w*)\]/g, (_, arr, s, e) => {
        if (s && e) return `${arr}.slice(${s}, ${e})`;
        if (s) return `${arr}.slice(${s})`;
        if (e) return `${arr}.slice(0, ${e})`;
        return `${arr}.slice()`;
    });
    expr = expr.replace(/\bstr\s*\(/g, 'String(');
    expr = expr.replace(/\bint\s*\(([^)]+)\)/g, 'Math.floor(Number($1))');
    expr = expr.replace(/f"([^"]*)"/g, (_, s) => '`' + s.replace(/\{/g, '${') + '`');
    expr = expr.replace(/f'([^']*)'/g, (_, s) => '`' + s.replace(/\{/g, '${') + '`');
    return expr;
}

function convertIntegerDivision(expr) {
    return expr.replace(/(.+?)\s*\/\/\s*(.+)/g, (_, a, b) => `Math.floor(${a.trim()} / ${b.trim()})`);
}

function makeIndent(level) {
    return '    '.repeat(Math.max(0, level));
}

// ══════════════════════════════════════════════════════════════
//  JAVA → JS TRANSPILER
// ══════════════════════════════════════════════════════════════

// Robust normalizer for Java code: collapses multi-line statements and removes comments
function normalizeJavaCode(code) {
    // Remove block comments
    code = code.replace(/\/\*[\s\S]*?\*\//g, '');
    // Remove inline comments
    code = code.split('\n').map(line => {
        let inString = false;
        for (let i = 0; i < line.length; i++) {
            if (line[i] === '"' && (i === 0 || line[i-1] !== '\\')) inString = !inString;
            if (!inString && line[i] === '/' && line[i+1] === '/') return line.substring(0, i);
        }
        return line;
    }).join('\n');

    // Remove imports
    code = code.replace(/^import\s+[\w\.\*]+;\s*$/gm, '');

    // Collapse multi-line statements
    let lines = code.split('\n');
    let merged = [];
    let currentLine = '';
    
    for (let raw of lines) {
        let trimmed = raw.trim();
        if (!trimmed) continue;
        
        currentLine = currentLine ? currentLine + ' ' + trimmed : trimmed;
        
        let lastChar = currentLine[currentLine.length - 1];
        // Statement ends if it ends with ;, {, }, or empty method signature ) {
        if (lastChar === ';' || lastChar === '{' || lastChar === '}' || currentLine.endsWith(') {')) {
            merged.push(currentLine);
            currentLine = '';
        }
    }
    if (currentLine) merged.push(currentLine);
    
    return merged.join('\n');
}

function transpileJava(rawCode) {
    let code = normalizeJavaCode(rawCode);
    let lines = code.split('\n');
    let jsLines = [];
    
    let skipBraceLevel = -1; 
    let braceLevel = 0;

    for (let i = 0; i < lines.length; i++) {
        let trimmed = lines[i].trim();
        if (!trimmed) continue;

        let jsIndent = ' '.repeat(Math.max(0, braceLevel * 4));

        // Flatten classes
        let classMatch = trimmed.match(/^(?:public\s+|private\s+|protected\s+|static\s+|abstract\s+|final\s+)*class\s+(\w+).*\{$/);
        if (classMatch) {
            skipBraceLevel = braceLevel;
            // dont output anything
            braceLevel++;
            continue; 
        }

        // Method declaration
        let methodMatch = trimmed.match(
            /^(?:public\s+|private\s+|protected\s+|static\s+|final\s+|abstract\s+|synchronized\s+)*(?:int|long|double|float|boolean|void|String|char|int\[\]|long\[\]|double\[\]|String\[\]|Object|<[a-zA-Z0-9_,<> ]+>|[A-Z]\w*)\s+(\w+)\s*\(([^)]*)\)\s*\{?$/
        );
        if (methodMatch) {
            let fnName = methodMatch[1];
            let rawParams = methodMatch[2];
            let params = rawParams.split(',').map(p => {
                p = p.trim();
                if (!p) return '';
                let parts = p.split(/\s+/);
                let name = parts[parts.length - 1]; 
                return name.replace(/\[\]/g, ''); 
            }).filter(Boolean).join(', ');
            
            let brace = trimmed.endsWith('{') ? ' {' : '';
            if (trimmed.endsWith('{')) braceLevel++;
            jsLines.push(`${jsIndent}function ${fnName}(${params})${brace}`);
            continue;
        }

        // Variable declarations
        let varDeclMatch = trimmed.match(
            /^(?:int|long|double|float|boolean|String|char|[A-Z]\w*)\s+(\w+)\s*=\s*(.+);$/
        );
        if (varDeclMatch) {
            jsLines.push(`${jsIndent}let ${varDeclMatch[1]} = ${convertJavaExpr(varDeclMatch[2])};`);
            continue;
        }

        let varDeclNoInit = trimmed.match(
            /^(?:int|long|double|float|boolean|String|char|[A-Z]\w*)\s+(\w+)\s*;$/
        );
        if (varDeclNoInit) {
            jsLines.push(`${jsIndent}let ${varDeclNoInit[1]};`);
            continue;
        }

        let arrMatch = trimmed.match(
            /^(?:int|long|double|float|String|char|[A-Z]\w*)\[\]\s+(\w+)\s*=\s*new\s+\w+\[(.+)\];$/
        );
        if (arrMatch) {
            jsLines.push(`${jsIndent}let ${arrMatch[1]} = new Array(${arrMatch[2]}).fill(0);`);
            continue;
        }

        let printMatch = trimmed.match(/^System\.out\.print(?:ln)?\s*\((.*)\)\s*;$/);
        if (printMatch) {
            jsLines.push(`${jsIndent}__print(${convertJavaExpr(printMatch[1])});`);
            continue;
        }

        let forMatch = trimmed.match(/^for\s*\(\s*(?:int|long|double|float)?\s*(.+)\)\s*\{?$/);
        if (forMatch) {
            let brace = trimmed.endsWith('{') ? ' {' : '';
            if (trimmed.endsWith('{')) braceLevel++;
            let loopContent = forMatch[1];
            loopContent = loopContent.replace(/^(?:int|long|double|float)\s+/, 'let ');
            jsLines.push(`${jsIndent}for (${loopContent})${brace}`);
            continue;
        }
        
        let whileMatch = trimmed.match(/^while\s*\((.+)\)\s*\{?$/);
        if (whileMatch) {
            let brace = trimmed.endsWith('{') ? ' {' : '';
            if (trimmed.endsWith('{')) braceLevel++;
            jsLines.push(`${jsIndent}while (${convertJavaExpr(whileMatch[1])})${brace}`);
            continue;
        }

        let ifMatch = trimmed.match(/^(if|else\s+if|else)\s*(.*)$/);
        if (ifMatch) {
            if (trimmed.endsWith('{')) braceLevel++;
            jsLines.push(`${jsIndent}${convertJavaExpr(trimmed)}`);
            continue;
        }

        let retMatch = trimmed.match(/^return\s*(.*);$/);
        if (retMatch) {
            let val = retMatch[1].trim();
            if (val === '') jsLines.push(`${jsIndent}return;`);
            else jsLines.push(`${jsIndent}return ${convertJavaExpr(val)};`);
            continue;
        }

        if (trimmed === '}') {
            braceLevel--;
            if (braceLevel === skipBraceLevel) {
                // Closing brace of a flattened class, ignore it
                skipBraceLevel = -1;
                continue;
            }
            jsIndent = ' '.repeat(Math.max(0, braceLevel * 4));
            jsLines.push(`${jsIndent}}`);
            continue;
        }

        if (trimmed === '{') {
            braceLevel++;
            jsLines.push(`${jsIndent}{`);
            continue;
        }

        if (trimmed.endsWith('{')) braceLevel++;
        jsLines.push(`${jsIndent}${convertJavaExpr(trimmed)}`);
    }

    return jsLines.join('\n');
}

function convertJavaExpr(expr) {
    expr = expr.replace(/\.length\(\)/g, '.length');
    expr = expr.replace(/\.equals\s*\(([^)]+)\)/g, ' === $1');
    expr = expr.replace(/\.substring\s*\(/g, '.slice(');
    expr = expr.replace(/\.charAt\s*\((\w+)\)/g, '[$1]');
    expr = expr.replace(/Integer\.parseInt/g, 'parseInt');
    return expr;
}

// ══════════════════════════════════════════════════════════════
//  INSTRUMENTATION — Wrap functions for tracing
// ══════════════════════════════════════════════════════════════

function instrumentCode(jsCode) {
    const fnRegex = /(^|[\s;}])(?:function\s+)?(?!\b(?:if|else|for|while|switch|catch|new|return|constructor|this|super)\b)([a-zA-Z_$][0-9a-zA-Z_$]*)\s*\(([^)]*)\)\s*\{/g;
    let match;
    const functions = [];

    while ((match = fnRegex.exec(jsCode)) !== null) {
        let offset = match[1].length;
        functions.push({
            name: match[2],
            params: match[3].split(',').map(s => s.trim()).filter(Boolean),
            index: match.index + offset,
            bodyStart: match.index + match[0].length
        });
    }

    if (functions.length === 0) {
        throw new Error('No function found in the code. Please define a function.');
    }

    let instrumented = jsCode;
    for (let i = functions.length - 1; i >= 0; i--) {
        const fn = functions[i];
        const paramList = fn.params.map(p => p.replace(/^let\s+/, '')).join(', ');
        const traceEntry = `\n    __enter("${fn.name}", [${paramList}]);\n    try {\n`;

        let braceCount = 1;
        let pos = fn.bodyStart;
        while (pos < instrumented.length && braceCount > 0) {
            if (instrumented[pos] === '{') braceCount++;
            if (instrumented[pos] === '}') braceCount--;
            pos++;
        }
        const bodyEnd = pos - 1; 

        let body = instrumented.slice(fn.bodyStart, bodyEnd);
        body = body.replace(/\breturn\s+(.*?);/g, (_, val) => {
            return `{ let __rv = ${val}; __exit(__rv); return __rv; }`;
        });
        body = body.replace(/\breturn\s*;/g, '{ __exit(undefined); return; }');

        instrumented = instrumented.slice(0, fn.bodyStart)
            + traceEntry
            + body
            + '\n    } catch(__e) { __exit(__e.isRecursionLimit ? "LIMIT" : "ERROR"); throw __e; }\n'
            + instrumented.slice(bodyEnd);
    }

    return instrumented;
}

// ══════════════════════════════════════════════════════════════
//  EXECUTION ENGINE
// ══════════════════════════════════════════════════════════════

function executeCode(code, fnCall) {
    callTree = null;
    callCounter = 0;
    consoleLines = [];
    clearConsole();

    let jsCode;
    try {
        if (currentLang === 'python') {
            jsCode = transpilePython(code);
        } else {
            jsCode = transpileJava(code);
        }
    } catch (e) {
        throw new Error('Transpilation error: ' + e.message);
    }

    let instrumented;
    try {
        instrumented = instrumentCode(jsCode);
    } catch (e) {
        throw e;
    }

    const callStack = [];
    const rootChildren = [];
    let rootNode = null;
    let stepCount = 0;

    function __enter(name, args) {
        stepCount++;
        if (stepCount > RECURSION_LIMIT) {
            throw { isRecursionLimit: true, message: `Too many steps! Lower the values.` };
        }
        const node = {
            id: stepCount,
            name: name,
            args: args.map(a => formatValue(a)),
            returnValue: null,
            children: [],
            depth: callStack.length
        };
        if (callStack.length > 0) {
            callStack[callStack.length - 1].children.push(node);
        } else {
            rootChildren.push(node);
        }
        callStack.push(node);
    }

    function __exit(retVal) {
        if (callStack.length > 0) {
            callStack[callStack.length - 1].returnValue = formatValue(retVal);
            callStack.pop();
        }
    }

    function __print(...args) {
        consolePrint(args.join(' '));
    }

    try {
        // Strip class prefixes like "new Solution().", "GFG.", etc. since we flatten everything
        let safeFnCall = fnCall.replace(/(?:new\s+[a-zA-Z0-9_]+\s*\(\)\s*\.)/g, '');
        safeFnCall = safeFnCall.replace(/(?:[a-zA-Z0-9_]+\.)/g, '');
        
        let argsDefStr = "";
        // if user tries calling main(args) or main(), ensure we don't throw ReferenceError for missing arguments array
        if(safeFnCall.startsWith('main(') && safeFnCall.replace(/\s/g,'') === 'main()') {
            argsDefStr = "let args = []; ";
        } else if (safeFnCall.startsWith('main(new String[]{})')) { // Handle some standard Java main calls
           safeFnCall = 'main([])';
        }
        
        const fullCode = instrumented + '\n\n' + argsDefStr + 'return (' + safeFnCall + ');';
        const fn = new Function('__enter', '__exit', '__print', fullCode);
        fn(__enter, __exit, __print);
    } catch (e) {
        if (e.isRecursionLimit) {
            callCounter = stepCount;
            throw e;
        }
        throw new Error('Runtime error: ' + e.message);
    }

    callCounter = stepCount;
    callTree = rootChildren[0] || null;
    return callTree;
}

function formatValue(val) {
    if (val === undefined || val === null) return 'null';
    if (typeof val === 'string') return `"${val}"`;
    if (Array.isArray(val)) return '[' + val.map(formatValue).join(', ') + ']';
    return String(val);
}

// ══════════════════════════════════════════════════════════════
//  VISUALIZATION RENDERER
// ══════════════════════════════════════════════════════════════

function renderTree(node) {
    vizPlaceholder.classList.add('hidden');
    vizTree.classList.add('active');
    vizTree.innerHTML = '';

    if (!node) {
        vizTree.innerHTML = '<div style="color:var(--text-muted);padding:24px;">No recursive calls detected.</div>';
        return;
    }

    const fragment = document.createDocumentFragment();
    renderNode(node, fragment, 0);
    vizTree.appendChild(fragment);
}

function renderNode(node, parent, animDelay) {
    const wrapper = document.createElement('div');
    wrapper.className = 'call-node';
    wrapper.style.animationDelay = `${animDelay * 60}ms`;

    const depthMod = node.depth % 10;

    const block = document.createElement('div');
    block.className = 'call-block';
    block.setAttribute('data-depth', depthMod);

    const order = document.createElement('span');
    order.className = 'call-order';
    order.textContent = `#${node.id}`;

    let toggle = null;
    if (node.children && node.children.length > 0) {
        toggle = document.createElement('span');
        toggle.className = 'call-toggle';
        toggle.textContent = '▼';
    }

    const sig = document.createElement('span');
    sig.className = 'call-signature';
    sig.innerHTML = `<span class="fn-name">${escapeHtml(node.name)}</span><span class="fn-args">(${node.args.map(escapeHtml).join(', ')})</span>`;

    const ret = document.createElement('span');
    ret.className = 'call-return';
    if (node.returnValue !== null && node.returnValue !== undefined) {
        const isError = node.returnValue === 'ERROR' || node.returnValue === 'LIMIT';
        ret.textContent = `→ ${node.returnValue}`;
        if (isError) ret.classList.add('error-return');
    }

    block.appendChild(order);
    if (toggle) block.appendChild(toggle);
    block.appendChild(sig);
    block.appendChild(ret);
    wrapper.appendChild(block);

    if (node.children && node.children.length > 0) {
        const childContainer = document.createElement('div');
        childContainer.className = 'call-children';

        let childDelay = animDelay + 1;
        node.children.forEach(child => {
            renderNode(child, childContainer, childDelay);
            childDelay += countNodes(child);
        });

        wrapper.appendChild(childContainer);

        block.addEventListener('click', () => {
            const isCollapsed = childContainer.classList.toggle('collapsed');
            if (toggle) toggle.classList.toggle('collapsed', isCollapsed);
        });
    }

    parent.appendChild(wrapper);
}

function countNodes(node) {
    let count = 1;
    if (node.children) {
        node.children.forEach(c => count += countNodes(c));
    }
    return count;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

function collapseAll() {
    vizTree.querySelectorAll('.call-children').forEach(el => el.classList.add('collapsed'));
    vizTree.querySelectorAll('.call-toggle').forEach(el => el.classList.add('collapsed'));
}
function expandAll() {
    vizTree.querySelectorAll('.call-children').forEach(el => el.classList.remove('collapsed'));
    vizTree.querySelectorAll('.call-toggle').forEach(el => el.classList.remove('collapsed'));
}

// ══════════════════════════════════════════════════════════════
//  CONSOLE RESIZE & SCALABLE TEXT
// ══════════════════════════════════════════════════════════════
let isResizingConsole = false;
let currentConsoleHeight = 140;

consoleResizer.addEventListener('mousedown', (e) => {
    isResizingConsole = true;
    consoleResizer.classList.add('active');
    document.body.style.cursor = 'ns-resize';
});

document.addEventListener('mousemove', (e) => {
    if (!isResizingConsole) return;
    const containerRect = $('vizPanel').getBoundingClientRect();
    const newHeight = containerRect.bottom - e.clientY;
    // Keep between 40px and container's height minus 100px for safety
    if (newHeight >= 40 && newHeight <= containerRect.height - 100) {
        currentConsoleHeight = newHeight;
        consolePanel.style.height = currentConsoleHeight + 'px';
    }
});

document.addEventListener('mouseup', () => {
    if (isResizingConsole) {
        isResizingConsole = false;
        consoleResizer.classList.remove('active');
        document.body.style.cursor = '';
    }
});

let consoleFontSize = 12.5;

consoleOutput.addEventListener('wheel', (e) => {
    if (e.altKey) {
        e.preventDefault(); 
        if (e.deltaY < 0) {
            consoleFontSize += 1;
        } else {
            consoleFontSize -= 1;
        }
        consoleFontSize = Math.max(8, Math.min(32, consoleFontSize)); 
        consoleOutput.style.fontSize = consoleFontSize + 'px';
    }
}, { passive: false });

let editorFontSize = 14; // Default defined in CSS

function initEditorZoom() {
    if(!editor || !editor.getWrapperElement) return;
    const wrapper = editor.getWrapperElement();
    wrapper.addEventListener('wheel', (e) => {
        if (e.altKey) {
            e.preventDefault(); 
            if (e.deltaY < 0) {
                editorFontSize += 1;
            } else {
                editorFontSize -= 1;
            }
            editorFontSize = Math.max(8, Math.min(48, editorFontSize)); 
            wrapper.style.fontSize = editorFontSize + 'px';
            editor.refresh();
        }
    }, { passive: false });
}

// ══════════════════════════════════════════════════════════════
//  EVENT HANDLERS
// ══════════════════════════════════════════════════════════════

function run() {
    hideError();
    const code = editor.getValue();
    const fnCall = fnInput.value.trim();

    if (!code.trim()) {
        showError('Please write code in the editor.');
        return;
    }
    if (!fnCall) {
        showError('Please provide a function or class instantiation call.');
        return;
    }

    btnRun.classList.add('running');
    stepCount.textContent = '0';
    stepCount.className = 'step-count';

    setTimeout(() => {
        try {
            const tree = executeCode(code, fnCall);
            updateStepBadge();
            renderTree(tree);
            if (tree && tree.returnValue && tree.returnValue !== 'null') {
                consolePrint(`\nOutput: ${tree.returnValue}`);
            }
        } catch (e) {
            updateStepBadge();
            if (e.isRecursionLimit) {
                vizTree.innerHTML = '';
                vizTree.classList.remove('active');
                vizPlaceholder.classList.remove('hidden');
                
                hideError();
                
                setTimeout(() => {
                    alert('Too many steps! Lower the values.');
                }, 10);
            } else {
                showError(e.message);
                consolePrint(e.message, true);
            }
        } finally {
            btnRun.classList.remove('running');
        }
    }, 50);
}

function updateStepBadge() {
    stepCount.textContent = callCounter;
    if (callCounter > 150) {
        stepCount.className = 'step-count danger';
    } else if (callCounter > 100) {
        stepCount.className = 'step-count warning';
    } else {
        stepCount.className = 'step-count';
    }
}

function resetEditor() {
    const example = EXAMPLES[currentLang];
    editor.setValue(example.code);
    fnInput.value = example.call;
    hideError();
    clearConsole();
    vizPlaceholder.classList.remove('hidden');
    vizTree.classList.remove('active');
    vizTree.innerHTML = '';
    stepCount.textContent = '0';
    stepCount.className = 'step-count';
}

document.addEventListener('DOMContentLoaded', () => {
    initEditor();
    initEditorZoom();

    btnPython.addEventListener('click', () => {
        switchLanguage('python');
        resetEditor();
    });
    btnJava.addEventListener('click', () => {
        switchLanguage('java');
        resetEditor();
    });

    btnRun.addEventListener('click', run);
    btnReset.addEventListener('click', resetEditor);
    errorClose.addEventListener('click', hideError);
    btnClearConsole.addEventListener('click', clearConsole);
    btnCollapseAll.addEventListener('click', collapseAll);
    btnExpandAll.addEventListener('click', expandAll);

    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            run();
        }
    });
});
