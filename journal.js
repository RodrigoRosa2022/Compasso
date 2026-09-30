// Pending user actions live inside the same localStorage value as the data.
// They are deliberately omitted from cloud backups.
(function (global) {
  'use strict';
  const collections = ['students', 'classSchedules', 'billingRules', 'books', 'studentBooks',
    'repertoire', 'studentRepertoire', 'paymentRecords', 'classOverrides'];
  const clone = value => JSON.parse(JSON.stringify(value));
  const key = (name, item) => String(name === 'paymentRecords' ? item.key : item.id);
  function sorted(value) {
    if (Array.isArray(value)) return value.map(sorted);
    if (value && typeof value === 'object') return Object.fromEntries(
      Object.keys(value).sort().map(name => [name, sorted(value[name])]));
    return value;
  }
  function material(backup) {
    const data = clone(backup?.data || backup);
    if (!data || data.schemaVersion !== 2) throw new Error('Estrutura local inválida.');
    delete data.meta;
    if (data.settings) {
      delete data.settings.lastBackupAt;
      delete data.settings.lastCloudRestoreAt;
    }
    for (const name of collections) {
      if (!Array.isArray(data[name])) throw new Error('Coleção ausente: ' + name);
      data[name].sort((a, b) => key(name, a).localeCompare(key(name, b)));
    }
    return sorted(JSON.parse(JSON.stringify(data, (name, value) =>
      name === 'foto' || name === 'photo' ? undefined : value)));
  }
  const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
  function changes(before, after) {
    const result = [];
    for (const name of collections) {
      const old = new Map(before[name].map(item => [key(name, item), item]));
      const next = new Map(after[name].map(item => [key(name, item), item]));
      for (const id of new Set([...old.keys(), ...next.keys()])) {
        const previous = old.get(id) || null, current = next.get(id) || null;
        if (!same(previous, current)) result.push({ collection: name, id, before: previous, after: current });
      }
    }
    for (const name of new Set([...Object.keys(before.settings || {}), ...Object.keys(after.settings || {})])) {
      const previous = before.settings?.[name] ?? null, current = after.settings?.[name] ?? null;
      if (!same(previous, current)) result.push({ collection: 'settings', id: name, before: previous, after: current });
    }
    return result;
  }
  function apply(base, entries) {
    const result = material(base);
    for (const entry of entries) for (const change of entry.changes || []) {
      if (change.collection === 'settings') {
        const actual = result.settings?.[change.id] ?? null;
        if (!same(actual, change.before)) throw new Error('A configuração mudou na nuvem.');
        result.settings = result.settings || {};
        if (change.after === null) delete result.settings[change.id];
        else result.settings[change.id] = clone(change.after);
        continue;
      }
      if (!collections.includes(change.collection)) throw new Error('Tipo de alteração desconhecido.');
      const list = result[change.collection], index = list.findIndex(item => key(change.collection, item) === change.id);
      const actual = index < 0 ? null : list[index];
      if (!same(actual, change.before)) throw new Error('Um registro mudou na nuvem.');
      if (change.after === null) { if (index >= 0) list.splice(index, 1); }
      else if (index >= 0) list[index] = clone(change.after);
      else list.push(clone(change.after));
      list.sort((a, b) => key(change.collection, a).localeCompare(key(change.collection, b)));
    }
    return sorted(result);
  }
  function describe(change, before, after) {
    const names = { students: 'Aluno', classSchedules: 'Horário', billingRules: 'Plano',
      books: 'Livro', studentBooks: 'Livro do aluno', repertoire: 'Música',
      studentRepertoire: 'Repertório do aluno', paymentRecords: 'Pagamento',
      classOverrides: 'Aula', settings: 'Perfil' };
    const item = change.after || change.before;
    const student = (after.students || before.students || []).find(row => String(row.id) === String(item?.studentId));
    const title = item?.name || item?.title || student?.name || item?.reference || change.id;
    return names[change.collection] + ': ' + title;
  }
  global.CompassoJournal = { collections, material, same, changes, apply, describe };
})(window);
