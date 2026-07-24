const fs = require('fs');
let code = fs.readFileSync('public/app.js', 'utf8');

// Update state.classes on transfer so the new class exists in memory
code = code.replace(
  const idx = state.students.findIndex(s => s.id === id);,
  if (!state.classes.includes(newClass)) state.classes.push(newClass);\n    const idx = state.students.findIndex(s => s.id === id);
);

// We also should re-render the dropdown so it updates!
code = code.replace(
  enderRoster();\n  } catch(err) {,
  enderClassDropdown();\n    renderRoster();\n  } catch(err) {
);

fs.writeFileSync('public/app.js', code);
console.log('Fixed app.js transfer logic');
