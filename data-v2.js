(function(global){
'use strict';

const SCHEMA_VERSION=2;
const clone=value=>JSON.parse(JSON.stringify(value));
const norm=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase().replace(/\s+/g,' ');
const iso=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||''))?String(value):'';
const today=()=>{const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`};
const dateAtNoon=value=>new Date(`${value}T12:00:00`);
const dayBefore=value=>{const date=dateAtNoon(value);date.setDate(date.getDate()-1);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`};
const maxDate=(...values)=>values.filter(Boolean).sort().at(-1)||'';
const minDate=(...values)=>values.filter(Boolean).sort()[0]||'';
const hash=value=>{let result=2166136261;for(const character of String(value)){result^=character.charCodeAt(0);result=Math.imul(result,16777619)}return (result>>>0).toString(36)};
const stableId=(prefix,value)=>`${prefix}-${hash(value)}`;
const newId=prefix=>`${prefix}-${global.crypto?.randomUUID?.()||`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`}`;
const stageToCode=value=>({'Em espera':'waiting','Aprendendo':'learning','Executando':'performing',waiting:'waiting',learning:'learning',performing:'performing'}[value]||'learning');
const stageToLabel=value=>({waiting:'Em espera',learning:'Aprendendo',performing:'Executando'}[value]||value||'Aprendendo');
const planToCode=value=>value==='Por aula'||value==='per_class'?'per_class':'monthly';
const planToLabel=value=>value==='per_class'?'Por aula':'Mensal';
const paymentStatus=value=>value==='paid'||value===true?'paid':'pending';
const cents=value=>Math.round(Number(value||0)*100);
const reais=value=>Number(value||0)/100;
const monthNames={janeiro:'01',fevereiro:'02','março':'03',marco:'03',abril:'04',maio:'05',junho:'06',julho:'07',agosto:'08',setembro:'09',outubro:'10',novembro:'11',dezembro:'12'};

function normalizeCanonical(raw){
  const source=clone(raw||{});
  return {
    schemaVersion:SCHEMA_VERSION,
    students:Array.isArray(source.students)?source.students:[],
    classSchedules:Array.isArray(source.classSchedules)?source.classSchedules:[],
    billingRules:Array.isArray(source.billingRules)?source.billingRules:[],
    books:Array.isArray(source.books)?source.books:[],
    studentBooks:Array.isArray(source.studentBooks)?source.studentBooks:[],
    repertoire:Array.isArray(source.repertoire)?source.repertoire:[],
    studentRepertoire:Array.isArray(source.studentRepertoire)?source.studentRepertoire:[],
    paymentRecords:Array.isArray(source.paymentRecords)?source.paymentRecords:[],
    classOverrides:Array.isArray(source.classOverrides)?source.classOverrides:[],
    settings:source.settings&&typeof source.settings==='object'?source.settings:{teacherName:'',schoolName:''},
    meta:source.meta&&typeof source.meta==='object'?source.meta:{}
  };
}

function inferPaymentDate(payment){
  if(iso(payment.dueDate))return payment.dueDate;
  const reference=String(payment.ref||payment.reference||'');
  const monthMatch=reference.match(/([A-Za-zÀ-ÿ]+)\s*\/\s*(\d{4})/);
  if(monthMatch){const month=monthNames[norm(monthMatch[1])];if(month)return `${monthMatch[2]}-${month}-01`}
  const classMatch=reference.match(/(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{4}))?/);
  if(classMatch)return `${classMatch[3]||new Date().getFullYear()}-${String(classMatch[2]).padStart(2,'0')}-${String(classMatch[1]).padStart(2,'0')}`;
  return '';
}

function hasReceipt(record){return record.status==='paid'||!!record.confirmedAt||(record.history||[]).some(event=>event.type==='confirmed')}

function runtimePayment(record){
  return {id:record.key,alunoId:record.studentId,studentName:record.studentName||'',ref:record.reference||'',valor:reais(record.amountCents),pago:record.status==='paid',pagoEm:record.confirmedAt||undefined,notes:record.notes||'',dueDate:record.dueDate||'',autoKey:record.key,kind:record.kind||'manual',history:clone(record.history||[]),_persisted:true,_excluded:record.status==='excluded',exclusionReason:record.exclusionReason||''};
}

function classIdFor(schedule,date){return `class:${schedule.id}:${date}`}
function monthlyPaymentKey(studentId,month){return `payment:monthly:${studentId}:${month}`}
function classPaymentKey(studentId,scheduleId,date){return `payment:class:${studentId}:${scheduleId}:${date}`}

function fromLegacy(legacy){
  if(legacy?.schemaVersion===SCHEMA_VERSION&&Array.isArray(legacy.students))return normalizeCanonical(legacy);
  const source=clone(legacy||{}),studentsSource=Array.isArray(source.alunos)?source.alunos:[];
  const books=[],bookByName=new Map(),repertoire=[],repertoireByName=new Map();
  const addBook=item=>{const title=String(typeof item==='string'?item:item?.nome||item?.title||'').trim();if(!title)return null;const key=norm(title),existing=bookByName.get(key);if(existing){if(!existing.comments)existing.comments=item?.comentarios||item?.comments||'';if(!existing.author)existing.author=item?.autor||item?.author||'';if(!existing.photo)existing.photo=item?.foto||item?.photo;return existing}const book={id:item?.id||stableId('book',key),title,author:item?.autor||item?.author||'',comments:item?.comentarios||item?.comments||'',photo:item?.foto||item?.photo};books.push(book);bookByName.set(key,book);return book};
  const addRepertoire=item=>{const title=String(typeof item==='string'?item:item?.nome||item?.title||'').trim();if(!title)return null;const key=norm(title),existing=repertoireByName.get(key);if(existing){if(!existing.author)existing.author=item?.autor||item?.author||'';if(!existing.comments)existing.comments=item?.comentarios||item?.comments||'';if(!existing.photo)existing.photo=item?.foto||item?.photo;return existing}const entry={id:item?.id||stableId('repertoire',key),title,author:item?.autor||item?.author||'',comments:item?.comentarios||item?.comments||'',photo:item?.foto||item?.photo};repertoire.push(entry);repertoireByName.set(key,entry);return entry};
  (source.livros||[]).forEach(addBook);(source.repertorio||[]).forEach(addRepertoire);
  studentsSource.forEach(student=>{(student.livrosHistorico||[]).forEach(link=>addBook(link));if(student.livro)addBook(student.livro);(student.musicas||student.repertorio||[]).forEach(addRepertoire)});

  const students=studentsSource.map((student,index)=>({id:student.id??Date.now()+index,name:student.nome||'',initials:student.ini||'',color:student.cor||'',startDate:iso(student.desde)||today(),endDate:iso(student.encerradoEm)||(student.ativo===false?today():null),active:student.ativo!==false,birthDate:iso(student.nascimento)||'',contact:student.contato||'',notes:student.notas||'',photo:student.foto}));
  const classSchedules=[],billingRules=[],studentBooks=[],studentRepertoire=[];
  studentsSource.forEach((student,index)=>{
    const studentId=students[index].id,startDate=students[index].startDate,slots=Array.isArray(student.aulas)&&student.aulas.length?student.aulas:[{dia:student.dia||'Segunda',hora:student.hora||'10:00',duracao:student.duracao||50,criadoEm:startDate}];
    slots.forEach((slot,slotIndex)=>{const validFrom=maxDate(startDate,iso(slot.criadoEm)||startDate);classSchedules.push({id:slot.id||stableId('schedule',`${studentId}|${validFrom}|${slot.dia}|${slot.hora}|${slotIndex}`),studentId,weekday:slot.dia||'Segunda',time:slot.hora||'10:00',duration:Number(slot.duracao)||50,validFrom,validTo:null})});
    billingRules.push({id:stableId('billing',`${studentId}|${startDate}|${student.plano}|${student.valor}`),studentId,type:planToCode(student.plano),amountCents:cents(student.valor),validFrom:startDate,validTo:null});
    (student.livrosHistorico||[]).forEach((link,linkIndex)=>{const book=addBook(link);if(!book)return;const startedAt=iso(link.inicio)||startDate,completedAt=iso(link.fim)||null;studentBooks.push({id:link.linkId||stableId('student-book',`${studentId}|${book.id}|${startedAt}|${linkIndex}`),studentId,bookId:book.id,startedAt,completedAt})});
    (student.musicas||student.repertorio||[]).forEach((link,linkIndex)=>{const item=addRepertoire(link);if(!item)return;const startedAt=iso(link.inicio)||startDate,statusEvents=(Array.isArray(link.statusHistorico)&&link.statusHistorico.length?link.statusHistorico:[{status:link.status||'Aprendendo',data:startedAt}]).map(event=>({status:stageToCode(event.status),date:iso(event.data)||startedAt})).sort((a,b)=>a.date.localeCompare(b.date));studentRepertoire.push({id:link.linkId||stableId('student-repertoire',`${studentId}|${item.id}|${startedAt}|${linkIndex}`),studentId,repertoireId:item.id,startedAt,completedAt:iso(link.fim)||null,statusEvents})});
  });

  const schedulesByStudent=studentId=>classSchedules.filter(schedule=>String(schedule.studentId)===String(studentId));
  const legacyClassId=(record,idMap)=>{const match=String(record.id||'').match(/^regular-(.+)-(\d{4}-\d{2}-\d{2})-(\d+)$/);if(!match)return String(record.id||newId('class-override'));const schedule=schedulesByStudent(record.studentId)[Number(match[3])];const id=schedule?classIdFor(schedule,match[2]):String(record.id);idMap.set(String(record.id),id);return id};
  const classIdMap=new Map(),keptClasses=(source.classRecords||[]).filter(record=>record.status&&record.status!=='pending'||record.notes||record.rescheduled||record.rescheduledTo||record.originId);
  const classOverrides=keptClasses.map(record=>({...record,id:legacyClassId(record,classIdMap),studentId:record.studentId}));
  classOverrides.forEach(record=>{if(record.originId&&classIdMap.has(String(record.originId)))record.originId=classIdMap.get(String(record.originId))});

  const paymentRecords=(source.pagamentos||[]).filter(payment=>payment.pago||payment.pagoEm||payment.notes||payment.history?.length||!payment.autoKey).map(payment=>{
    const studentId=payment.alunoId??payment.aluno,dueDate=inferPaymentDate(payment),slots=schedulesByStudent(studentId),legacyStudent=studentsSource.find(student=>String(student.id)===String(studentId)),looksLikeClass=/^\s*Aula\b/i.test(String(payment.ref||'')),looksLikeMonth=/[A-Za-zÀ-ÿ]+\s*\/\s*\d{4}/.test(String(payment.ref||''));let kind=payment.autoKey?.includes('-monthly-')?'monthly':payment.autoKey?.includes('-class-')?'per_class':looksLikeClass?'per_class':looksLikeMonth&&legacyStudent?.plano==='Mensal'?'monthly':'manual',key;
    if(kind==='monthly'){const month=(payment.autoKey?.match(/(\d{4}-\d{2})$/)||[])[1]||dueDate.slice(0,7);key=monthlyPaymentKey(studentId,month)}
    else if(kind==='per_class'){const match=payment.autoKey?.match(/-class-(\d{4}-\d{2}-\d{2})-(\d+)$/),date=match?.[1]||dueDate,dateObject=date?dateAtNoon(date):null,schedule=match?slots[Number(match[2])]:slots.find(item=>dateObject&&dateObject.getDay()===((['Segunda','Terça','Quarta','Quinta','Sexta','Sábado','Domingo'].indexOf(item.weekday)+1)%7));key=schedule&&date?classPaymentKey(studentId,schedule.id,date):`payment:legacy:${payment.id}`}
    else key=`payment:manual:${payment.id||newId('manual')}`;
    if(String(payment.autoKey||'').startsWith('payment:')){key=String(payment.autoKey);kind=payment.kind||kind}
    const status=payment.pago?'paid':'pending',history=clone(payment.history||[]);if(status==='paid'&&!history.some(event=>event.type==='confirmed'))history.push({type:'confirmed',at:payment.pagoEm||null});
    return {key,studentId,studentName:payment.studentName||legacyStudent?.nome||'Aluno removido',dueDate,kind,status,amountCents:cents(payment.valor),reference:payment.ref||'',confirmedAt:payment.pagoEm||null,notes:payment.notes||'',history,manual:kind==='manual'};
  });

  return normalizeCanonical({schemaVersion:SCHEMA_VERSION,students,classSchedules,billingRules,books,studentBooks,repertoire,studentRepertoire,paymentRecords,classOverrides,settings:source.settings||{teacherName:'',schoolName:''},meta:{migratedAt:new Date().toISOString(),demoEligible:source.demoEligible===true,demoKurtSeyit:source.demoKurtSeyit===true,dataErased:source.dataErased===true,academicLinksVersion:source.academicLinksVersion||1}});
}

function hydrate(raw){
  const canonical=normalizeCanonical(raw),bookMap=new Map(canonical.books.map(book=>[book.id,book])),repertoireMap=new Map(canonical.repertoire.map(item=>[item.id,item]));
  const alunos=canonical.students.map((student,index)=>{
    let schedules=canonical.classSchedules.filter(schedule=>String(schedule.studentId)===String(student.id)&&!schedule.validTo);if(!schedules.length){const all=canonical.classSchedules.filter(schedule=>String(schedule.studentId)===String(student.id)).sort((a,b)=>b.validFrom.localeCompare(a.validFrom));const latest=all[0]?.validFrom;schedules=all.filter(schedule=>schedule.validFrom===latest)}
    const rules=canonical.billingRules.filter(rule=>String(rule.studentId)===String(student.id)).sort((a,b)=>a.validFrom.localeCompare(b.validFrom)),rule=rules.findLast?.(entry=>!entry.validTo)||rules.at(-1)||{type:'monthly',amountCents:0};
    const bookLinks=canonical.studentBooks.filter(link=>String(link.studentId)===String(student.id)).sort((a,b)=>a.startedAt.localeCompare(b.startedAt)).map(link=>{const book=bookMap.get(link.bookId),history=[{status:'Atual',data:link.startedAt}];if(link.completedAt)history.push({status:'Concluído',data:link.completedAt});return {linkId:link.id,bookId:link.bookId,nome:book?.title||'Livro removido',inicio:link.startedAt,fim:link.completedAt||undefined,status:link.completedAt?'Concluído':'Atual',statusHistorico:history}});
    const musicLinks=canonical.studentRepertoire.filter(link=>String(link.studentId)===String(student.id)).map(link=>{const item=repertoireMap.get(link.repertoireId),events=(link.statusEvents||[]).map(event=>({status:stageToLabel(event.status),data:event.date})),status=events.at(-1)?.status||'Aprendendo';return {linkId:link.id,repertoireId:link.repertoireId,nome:item?.title||'Repertório removido',autor:item?.author||'',inicio:link.startedAt,fim:link.completedAt||undefined,status,statusHistorico:events.length?events:[{status,data:link.startedAt}]}});
    const currentBook=[...bookLinks].reverse().find(link=>!link.fim),aulas=schedules.map(schedule=>({id:schedule.id,dia:schedule.weekday,hora:schedule.time,duracao:schedule.duration,criadoEm:schedule.validFrom}));
    return {id:student.id,nome:student.name,ini:student.initials||student.name.split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]).join('').toUpperCase(),cor:student.color||'#668981',desde:student.startDate,encerradoEm:student.endDate||undefined,ativo:student.active!==false,nascimento:student.birthDate||'',contato:student.contact||'',notas:student.notes||'',foto:student.photo,aulas,dia:aulas[0]?.dia||'Segunda',hora:aulas[0]?.hora||'10:00',duracao:aulas[0]?.duracao||50,plano:planToLabel(rule.type),valor:reais(rule.amountCents),livro:currentBook?.nome||'',livrosHistorico:bookLinks,musicas:musicLinks};
  });
  return {...canonical,alunos,pagamentos:canonical.paymentRecords.map(runtimePayment),livros:canonical.books.map(book=>({id:book.id,nome:book.title,autor:book.author||'',comentarios:book.comments||'',foto:book.photo})),repertorio:canonical.repertoire.map(item=>({id:item.id,nome:item.title,autor:item.author||'',comentarios:item.comments||'',foto:item.photo})),classRecords:clone(canonical.classOverrides),settings:clone(canonical.settings),demoEligible:canonical.meta.demoEligible===true,demoKurtSeyit:canonical.meta.demoKurtSeyit===true,dataErased:canonical.meta.dataErased===true,academicLinksVersion:canonical.meta.academicLinksVersion||2};
}

function attachCanonical(runtime,canonical){for(const key of ['schemaVersion','students','classSchedules','billingRules','books','studentBooks','repertoire','studentRepertoire','paymentRecords','classOverrides','meta'])runtime[key]=canonical[key];runtime.settings=runtime.settings||canonical.settings;return canonical}

function sync(runtime){
  if(runtime?.schemaVersion!==SCHEMA_VERSION||!Array.isArray(runtime.students))return attachCanonical(runtime,fromLegacy(runtime));
  const previous=normalizeCanonical(runtime),now=today();
  const oldBooks=new Map(previous.books.map(item=>[item.id,item])),oldBooksByName=new Map(previous.books.map(item=>[norm(item.title),item]));
  const books=(runtime.livros||[]).filter(item=>String(item.nome||'').trim()).map(item=>{const old=oldBooks.get(item.id)||oldBooksByName.get(norm(item.nome)),mapped={id:old?.id||newId('book'),title:item.nome,author:item.autor||old?.author||'',comments:item.comentarios||'',photo:item.foto};item.id=mapped.id;return mapped});
  const oldRepertoire=new Map(previous.repertoire.map(item=>[item.id,item])),oldRepertoireByName=new Map(previous.repertoire.map(item=>[norm(item.title),item]));
  const repertoire=(runtime.repertorio||[]).filter(item=>String(item.nome||'').trim()).map(item=>{const old=oldRepertoire.get(item.id)||oldRepertoireByName.get(norm(item.nome)),mapped={id:old?.id||newId('repertoire'),title:item.nome,author:item.autor||'',comments:item.comentarios||'',photo:item.foto};item.id=mapped.id;return mapped});
  const bookByName=new Map(books.map(item=>[norm(item.title),item])),repertoireByName=new Map(repertoire.map(item=>[norm(item.title),item]));
  const students=(runtime.alunos||[]).map((student,index)=>{const old=previous.students.find(item=>String(item.id)===String(student.id))||{};return {...old,id:student.id??newId('student'),name:student.nome||'',initials:student.ini||'',color:student.cor||'',startDate:iso(student.desde)||now,endDate:iso(student.encerradoEm)||null,active:student.ativo!==false,birthDate:iso(student.nascimento)||'',contact:student.contato||'',notes:student.notas||'',photo:student.foto}});

  const classSchedules=previous.classSchedules.filter(schedule=>schedule.validTo),usedSchedules=new Set();
  (runtime.alunos||[]).forEach(student=>{const oldActive=previous.classSchedules.filter(schedule=>String(schedule.studentId)===String(student.id)&&!schedule.validTo),start=iso(student.desde)||now;(student.aulas||[]).forEach((slot,index)=>{const validFrom=maxDate(start,iso(slot.criadoEm)||start);let match=oldActive.find(schedule=>!usedSchedules.has(schedule.id)&&(slot.id===schedule.id||(schedule.weekday===slot.dia&&schedule.time===slot.hora&&schedule.validFrom===validFrom)));if(match){usedSchedules.add(match.id);slot.id=match.id;classSchedules.push({...match,weekday:slot.dia,time:slot.hora,duration:Number(slot.duracao)||50})}else{const created={id:newId('schedule'),studentId:student.id,weekday:slot.dia,time:slot.hora,duration:Number(slot.duracao)||50,validFrom,validTo:null};slot.id=created.id;classSchedules.push(created)}});oldActive.filter(schedule=>!usedSchedules.has(schedule.id)&&schedule.validFrom<now).forEach(schedule=>classSchedules.push({...schedule,validTo:dayBefore(now)}))});

  const billingRules=previous.billingRules.filter(rule=>rule.validTo),usedRules=new Set();
  (runtime.alunos||[]).forEach(student=>{const active=previous.billingRules.filter(rule=>String(rule.studentId)===String(student.id)&&!rule.validTo).sort((a,b)=>b.validFrom.localeCompare(a.validFrom))[0],type=planToCode(student.plano),amountCents=cents(student.valor),start=iso(student.desde)||now;if(active&&active.type===type&&Number(active.amountCents)===amountCents){usedRules.add(active.id);billingRules.push(active)}else{if(active){usedRules.add(active.id);billingRules.push({...active,validTo:dayBefore(maxDate(now,start))})}billingRules.push({id:newId('billing'),studentId:student.id,type,amountCents,validFrom:maxDate(start,now),validTo:null})}});

  const oldBookLinks=new Map(previous.studentBooks.map(link=>[link.id,link])),oldMusicLinks=new Map(previous.studentRepertoire.map(link=>[link.id,link]));
  const studentBooks=[],studentRepertoire=[];
  (runtime.alunos||[]).forEach(student=>{
    (student.livrosHistorico||[]).forEach((link,index)=>{const book=bookByName.get(norm(link.nome));if(!book)return;const old=oldBookLinks.get(link.linkId)||previous.studentBooks.find(item=>String(item.studentId)===String(student.id)&&item.bookId===book.id&&item.startedAt===(iso(link.inicio)||student.desde)),mapped={id:old?.id||newId('student-book'),studentId:student.id,bookId:book.id,startedAt:iso(link.inicio)||student.desde||now,completedAt:iso(link.fim)||null};link.linkId=mapped.id;link.bookId=book.id;studentBooks.push(mapped)});
    (student.musicas||[]).forEach((link,index)=>{const item=repertoireByName.get(norm(link.nome));if(!item)return;const startedAt=iso(link.inicio)||student.desde||now,old=oldMusicLinks.get(link.linkId)||previous.studentRepertoire.find(entry=>String(entry.studentId)===String(student.id)&&entry.repertoireId===item.id&&entry.startedAt===startedAt),statusEvents=(link.statusHistorico||[{status:link.status||'Aprendendo',data:startedAt}]).map(event=>({status:stageToCode(event.status),date:iso(event.data)||startedAt})).sort((a,b)=>a.date.localeCompare(b.date)),mapped={id:old?.id||newId('student-repertoire'),studentId:student.id,repertoireId:item.id,startedAt,completedAt:iso(link.fim)||null,statusEvents};link.linkId=mapped.id;link.repertoireId=item.id;studentRepertoire.push(mapped)});
  });

  const existingPayments=new Map(previous.paymentRecords.map(record=>[record.key,record]));
  const paymentRecords=(runtime.pagamentos||[]).filter(payment=>payment._persisted||payment.pago||payment.pagoEm||payment.notes||payment.history?.length||!payment.autoKey).map(payment=>{const key=String(payment.autoKey||payment.id||newId('payment-manual')),old=existingPayments.get(key)||{},dueDate=inferPaymentDate(payment);return {...old,key,studentId:payment.alunoId,studentName:old.studentName||payment.studentName||students.find(student=>String(student.id)===String(payment.alunoId))?.name||previous.students.find(student=>String(student.id)===String(payment.alunoId))?.name||'Aluno removido',dueDate,kind:payment.kind||old.kind||(key.includes(':monthly:')?'monthly':key.includes(':class:')?'per_class':'manual'),status:payment._excluded?'excluded':payment.pago?'paid':'pending',amountCents:cents(payment.valor),reference:payment.ref||old.reference||'',confirmedAt:payment.pagoEm||null,notes:payment.notes||'',history:clone(payment.history||old.history||[]),manual:payment.kind==='manual'||old.manual===true,exclusionReason:payment.exclusionReason||old.exclusionReason||''}});
  // Receipts are independent of student lifecycle. Keep them even if a caller removes
  // the student or filters its payments. Explicit cancellation keeps its audit events.
  previous.paymentRecords.filter(hasReceipt).forEach(old=>{
    const index=paymentRecords.findIndex(record=>record.key===old.key);
    const retained={...old,studentName:old.studentName||previous.students.find(student=>String(student.id)===String(old.studentId))?.name||'Aluno removido'};
    if(index<0)paymentRecords.push(retained);
    else if(paymentRecords[index].status==='excluded')paymentRecords[index]=retained;
  });
  const classOverrides=(runtime.classRecords||[]).filter(record=>record.status&&record.status!=='pending'||record.notes||record.rescheduled||record.rescheduledTo||record.originId).map(record=>clone(record));
  const canonical=normalizeCanonical({schemaVersion:SCHEMA_VERSION,students,classSchedules,billingRules,books,studentBooks,repertoire,studentRepertoire,paymentRecords,classOverrides,settings:runtime.settings||previous.settings,meta:{...previous.meta,demoEligible:runtime.demoEligible===true,demoKurtSeyit:runtime.demoKurtSeyit===true,dataErased:runtime.dataErased===true,academicLinksVersion:2,updatedAt:new Date().toISOString()}});
  attachCanonical(runtime,canonical);runtime.classRecords=clone(classOverrides);return canonical;
}

function canonicalOnly(runtime){const canonical=sync(runtime);return clone(canonical)}
function studentActiveOn(student,date){return (!student.startDate||date>=student.startDate)&&(!student.endDate||date<=student.endDate)}
function scheduleActiveOn(schedule,date){return (!schedule.validFrom||date>=schedule.validFrom)&&(!schedule.validTo||date<=schedule.validTo)}
function billingRuleAt(runtime,studentId,date){return runtime.billingRules.filter(rule=>String(rule.studentId)===String(studentId)&&(!rule.validFrom||date>=rule.validFrom)&&(!rule.validTo||date<=rule.validTo)).sort((a,b)=>b.validFrom.localeCompare(a.validFrom))[0]||null}

function projectPayments(runtime,date,days){
  sync(runtime);const year=date.getFullYear(),month=String(date.getMonth()+1).padStart(2,'0'),monthKey=`${year}-${month}`,first=`${monthKey}-01`,lastDay=new Date(year,date.getMonth()+1,0).getDate(),last=`${monthKey}-${String(lastDay).padStart(2,'0')}`,records=new Map(runtime.paymentRecords.map(record=>[record.key,record])),result=[],seen=new Set(),monthName=date.toLocaleDateString('pt-BR',{month:'long'}),monthlyReference=`${monthName[0].toUpperCase()+monthName.slice(1)}/${year}`;
  runtime.students.forEach(student=>{
    const activeFrom=maxDate(first,student.startDate),activeTo=minDate(last,student.endDate||last);if(!activeFrom||activeFrom>activeTo)return;
    const monthlyRule=runtime.billingRules.filter(rule=>String(rule.studentId)===String(student.id)&&rule.type==='monthly'&&(!rule.validTo||rule.validTo>=activeFrom)&&(!rule.validFrom||rule.validFrom<=activeTo)).sort((a,b)=>a.validFrom.localeCompare(b.validFrom))[0];
    if(monthlyRule){const dueDate=maxDate(activeFrom,monthlyRule.validFrom),key=monthlyPaymentKey(student.id,monthKey),record=records.get(key);seen.add(key);if(record?.status!=='excluded'){const projection={id:key,autoKey:key,alunoId:student.id,ref:record?.reference||monthlyReference,valor:record?reais(record.amountCents):reais(monthlyRule.amountCents),pago:record?.status==='paid',pagoEm:record?.confirmedAt||undefined,notes:record?.notes||'',dueDate,kind:'monthly',history:clone(record?.history||[]),_persisted:!!record,_virtual:!record};result.push(projection)}}
    runtime.classSchedules.filter(schedule=>String(schedule.studentId)===String(student.id)).forEach(schedule=>{for(let day=1;day<=lastDay;day++){const current=new Date(year,date.getMonth(),day),dateKey=`${monthKey}-${String(day).padStart(2,'0')}`,wanted=(days.indexOf(schedule.weekday)+1)%7;if(current.getDay()!==wanted||!studentActiveOn(student,dateKey)||!scheduleActiveOn(schedule,dateKey))continue;const rule=billingRuleAt(runtime,student.id,dateKey);if(!rule||rule.type!=='per_class')continue;const key=classPaymentKey(student.id,schedule.id,dateKey),record=records.get(key),reference=`Aula ${String(day).padStart(2,'0')}/${month}`;seen.add(key);if(record?.status==='excluded')continue;result.push({id:key,autoKey:key,alunoId:student.id,ref:record?.reference||reference,valor:record?reais(record.amountCents):reais(rule.amountCents),pago:record?.status==='paid',pagoEm:record?.confirmedAt||undefined,notes:record?.notes||'',dueDate:dateKey,kind:'per_class',history:clone(record?.history||[]),_persisted:!!record,_virtual:!record})}})
  });
  runtime.paymentRecords.filter(record=>{const student=runtime.students.find(item=>String(item.id)===String(record.studentId));return record.status!=='excluded'&&record.dueDate?.startsWith(monthKey)&&!seen.has(record.key)&&(hasReceipt(record)||(student&&studentActiveOn(student,record.dueDate)))}).forEach(record=>result.push(runtimePayment(record)));
  return result.sort((a,b)=>`${a.dueDate}${a.alunoId}`.localeCompare(`${b.dueDate}${b.alunoId}`));
}

function projectClasses(runtime,from,to,days){
  sync(runtime);const overrides=new Map(runtime.classOverrides.map(record=>[String(record.id),record])),result=[],seen=new Set();
  runtime.classSchedules.forEach(schedule=>{const student=runtime.students.find(item=>String(item.id)===String(schedule.studentId));if(!student)return;const start=maxDate(from,student.startDate,schedule.validFrom),end=minDate(to,student.endDate||to,schedule.validTo||to);if(!start||start>end)return;for(let cursor=dateAtNoon(start);cursor<=dateAtNoon(end);cursor.setDate(cursor.getDate()+1)){const date=`${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}-${String(cursor.getDate()).padStart(2,'0')}`,wanted=(days.indexOf(schedule.weekday)+1)%7;if(cursor.getDay()!==wanted)continue;const id=classIdFor(schedule,date),override=overrides.get(id),record={id,studentId:schedule.studentId,scheduleId:schedule.id,date,time:schedule.time,duration:schedule.duration,status:'pending',day:schedule.weekday,...clone(override||{})};result.push(record);seen.add(id)}});
  runtime.classOverrides.filter(record=>record.date>=from&&record.date<=to&&!seen.has(String(record.id))).forEach(record=>{const student=runtime.students.find(item=>String(item.id)===String(record.studentId));if(student&&studentActiveOn(student,record.date))result.push(clone(record))});
  return result.sort((a,b)=>`${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
}

global.CompassoDataV2={SCHEMA_VERSION,fromLegacy,hydrate,sync,canonicalOnly,projectPayments,projectClasses,runtimePayment,newId,classIdFor,monthlyPaymentKey,classPaymentKey,planToCode,planToLabel,stageToCode,stageToLabel,dayBefore};
})(window);
