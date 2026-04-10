// Stockfish worker — runs in a child process
// Reads UCI commands from stdin, writes UCI output to stdout
const path = require('path');
const enginePath = path.join(__dirname, 'stockfish-18-lite-single.js');

const INIT_ENGINE = require(enginePath);

const moduleConfig = {
  locateFile: function(file) {
    if (file.endsWith('.wasm')) {
      return path.join(__dirname, 'stockfish-18-lite-single.wasm');
    }
    return path.join(__dirname, file);
  },
  print: function(line) {
    if (process.send) {
      process.send(line);
    }
  },
  printErr: function() {},
};

INIT_ENGINE()(moduleConfig).then(function(engine) {
  if (engine._isReady) {
    var check = function() {
      if (engine._isReady()) {
        delete engine._isReady;
        ready(engine);
      } else {
        setTimeout(check, 10);
      }
    };
    check();
  } else {
    ready(engine);
  }
});

function ready(engine) {
  engine.sendCommand = function(cmd) {
    setImmediate(function() {
      try {
        engine.ccall('command', null, ['string'], [cmd], { async: /^go\b/.test(cmd) });
      } catch(e) {}
    });
  };

  process.on('message', function(cmd) {
    engine.sendCommand(cmd);
  });

  if (process.send) {
    process.send('__ready__');
  }
}
