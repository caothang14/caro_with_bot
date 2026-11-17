/*
 * Bot files, loaded in exactly this order (paths relative to the bots/ folder).
 * Adding a bot = create a file in bots/ and add its name here. Both the UI and the arena read this list.
 */
(function (root) {
  const files = [
    'lib/position.js',
    'random.js',
    'greedy.js',
    'search.js',
    'levels.js',
  ];
  if (typeof module !== 'undefined' && module.exports) module.exports = files;
  else root.CaroBotManifest = files;
})(typeof globalThis !== 'undefined' ? globalThis : this);
