/* ============================================================
   LEGAL — Просмотр документов и форма согласия
   ============================================================ */

let _legalReturnScreen = 's-consent';

// ---- Открыть документ ----
function openLegalDoc(key, returnTo) {
  _legalReturnScreen = returnTo || 's-consent';
  const doc = _LEGAL[key];
  if (!doc) return;
  _setText('legal-doc-title', doc.title);
  const body = document.getElementById('legal-doc-body');
  if (body) { body.innerHTML = doc.html; body.scrollTop = 0; }
  showScreen('s-legal');
}

function closeLegalDoc() {
  showScreen(_legalReturnScreen);
}

// ---- Toggle custom checkbox ----
function toggleConsentCb(key) {
  const cb = document.getElementById('cb-' + key);
  const row = document.getElementById('cr-' + key);
  if (!cb) return;
  cb.classList.toggle('on');
  if (row) row.classList.toggle('checked', cb.classList.contains('on'));
  // Clear any red border from a failed submit attempt
  if (row) row.style.borderColor = '';
}

// ---- Показать экран согласия ----
function showConsentScreen() {
  ['passenger', 'driver', 'privacy'].forEach(key => {
    const cb = document.getElementById('cb-' + key);
    const row = document.getElementById('cr-' + key);
    if (cb) cb.classList.remove('on');
    if (row) { row.classList.remove('checked'); row.style.borderColor = ''; }
  });
  showScreen('s-consent');
}

// ---- Отправить согласие ----
async function submitConsent() {
  const keys = ['passenger', 'driver', 'privacy'];
  const unchecked = keys.filter(key => {
    const cb = document.getElementById('cb-' + key);
    return !cb || !cb.classList.contains('on');
  });
  if (unchecked.length) {
    showToast('Необходимо принять все документы', 'err');
    tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('error');
    keys.forEach(key => {
      const cb = document.getElementById('cb-' + key);
      const row = document.getElementById('cr-' + key);
      if (row) row.style.borderColor = (cb && !cb.classList.contains('on')) ? 'var(--red)' : '';
    });
    return;
  }
  showLoading(true);
  try {
    const cd = { consentGiven: true, consentAt: new Date().toISOString() };
    STATE.user = { ...STATE.user, ...cd };
    saveState();
    if (STATE.uid) await dbSet('users', STATE.uid, cd);
    showLoading(false);
    showToast('Добро пожаловать! 🎉', 'ok');
    tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('success');
    setTimeout(() => initMain(), 400);
  } catch (e) {
    showLoading(false);
    showToast('Ошибка. Попробуйте снова', 'err');
  }
}

// ===================================================================
// ДОКУМЕНТЫ
// ===================================================================
const _LEGAL = {

  // ---- СОГЛАШЕНИЕ ДЛЯ ВОДИТЕЛЕЙ ----
  driver: {
    title: 'Соглашение для водителей',
    html: `<div class="legal-body">
<div class="legal-doc-header">
  <div class="legal-doc-icon">🚗</div>
  <h1 class="legal-h1">Пользовательское соглашение<br>для водителей</h1>
</div>

<h2 class="legal-h2">1. Термины и определения</h2>
<div class="legal-item"><span class="legal-num">1.1.</span> <b>Платформа</b> — сервис (Telegram Mini App), предоставляющий информационные услуги.</div>
<div class="legal-item"><span class="legal-num">1.2.</span> <b>Пассажир</b> — пользователь, размещающий заказы.</div>
<div class="legal-item"><span class="legal-num">1.3.</span> <b>Водитель</b> — пользователь, откликающийся на заказы.</div>
<div class="legal-item"><span class="legal-num">1.4.</span> <b>Заказ</b> — размещённая заявка на поездку.</div>

<h2 class="legal-h2">2. Правовой статус платформы</h2>
<div class="legal-item"><span class="legal-num">2.1.</span> Платформа является исключительно информационной площадкой.</div>
<div class="legal-item"><span class="legal-num">2.2.</span> Платформа <b>не является</b>:
  <ul class="legal-list">
    <li>перевозчиком;</li>
    <li>таксомоторной службой;</li>
    <li>агрегатором такси;</li>
    <li>таксопарком;</li>
    <li>диспетчерской службой;</li>
    <li>агентом (в том числе налоговым агентом), представителем или работодателем водителей.</li>
  </ul>
</div>
<div class="legal-item"><span class="legal-num">2.3.</span> Платформа не оказывает транспортные услуги.</div>
<div class="legal-item"><span class="legal-num">2.4.</span> Все договорённости заключаются напрямую между Пассажиром и Водителем.</div>
<div class="legal-item"><span class="legal-num">2.5.</span> Платформа не является стороной сделки и не является посредником между Пассажиром и Водителем.</div>

<h2 class="legal-h2">3. Самостоятельный статус водителя</h2>
<div class="legal-item"><span class="legal-num">3.1.</span> Водитель действует как независимое лицо.</div>
<div class="legal-item"><span class="legal-num">3.2.</span> Водитель самостоятельно организует свою деятельность.</div>
<div class="legal-item"><span class="legal-num">3.3.</span> Платформа не гарантирует получение заказов или доход.</div>

<h2 class="legal-h2">4. Налоги и обязательства</h2>
<div class="legal-item"><span class="legal-num">4.1.</span> Платформа не является налоговым агентом ни в одной юрисдикции.</div>
<div class="legal-item"><span class="legal-num">4.2.</span> Водитель самостоятельно:
  <ul class="legal-list">
    <li>декларирует доходы;</li>
    <li>уплачивает налоги и обязательные платежи;</li>
    <li>взаимодействует с государственными органами.</li>
  </ul>
</div>
<div class="legal-item"><span class="legal-num">4.3.</span> Все налоговые обязательства и риски полностью лежат на Водителе.</div>

<h2 class="legal-h2">5. Финансовые условия</h2>
<div class="legal-item"><span class="legal-num">5.1.</span> Использование сервиса может быть платным.</div>
<div class="legal-item"><span class="legal-num">5.2.</span> Актуальная стоимость использования сервиса указывается в разделе «Профиль» внутри Платформы.</div>
<div class="legal-item"><span class="legal-num">5.3.</span> Оплата производится за доступ к функционалу Платформы.</div>
<div class="legal-item"><span class="legal-num">5.4.</span> Платформа не гарантирует получение заказов.</div>
<div class="legal-item"><span class="legal-num">5.5.</span> Платформа вправе в любое время изменять стоимость, вводить или отменять акции и бонусы без уведомления.</div>

<h2 class="legal-h2">6. Бонусы</h2>
<div class="legal-item"><span class="legal-num">6.1.</span> Все бонусные программы носят временный характер.</div>
<div class="legal-item"><span class="legal-num">6.2.</span> Платформа не обязана их предоставлять.</div>

<h2 class="legal-h2">7. Обязанности водителя</h2>
<div class="legal-item"><span class="legal-num">7.1.</span> Предоставлять достоверные данные и документы.</div>
<div class="legal-item"><span class="legal-num">7.2.</span> Не вводить Платформу и пользователей в заблуждение.</div>
<div class="legal-item"><span class="legal-num">7.3.</span> Соблюдать требования законодательства государства, на территории которого Водитель осуществляет деятельность в момент выполнения заказа.</div>
<div class="legal-item"><span class="legal-num">7.4.</span> Иметь все необходимые разрешения, лицензии (если применимо).</div>
<div class="legal-item"><span class="legal-num">7.5.</span> Обеспечивать безопасность перевозки.</div>
<div class="legal-item"><span class="legal-num">7.6.</span> Поддерживать транспортное средство в исправном состоянии.</div>

<h2 class="legal-h2">8. Ответственность водителя</h2>
<div class="legal-item"><span class="legal-num">8.1.</span> Водитель несёт полную самостоятельную ответственность за:
  <ul class="legal-list">
    <li>причинение вреда жизни, здоровью и имуществу пассажиров и третьих лиц;</li>
    <li>соблюдение требований законодательства государства, на территории которого осуществляется заказ;</li>
    <li>дорожно-транспортные происшествия;</li>
    <li>любые последствия оказания услуг перевозки.</li>
  </ul>
</div>

<h2 class="legal-h2">9. Проверка документов</h2>
<div class="legal-item"><span class="legal-num">9.1.</span> Платформа вправе запрашивать документы.</div>
<div class="legal-item"><span class="legal-num">9.2.</span> Проверка носит формальный и технический характер.</div>
<div class="legal-item"><span class="legal-num">9.3.</span> Водителю запрещается предоставлять недостоверные сведения.</div>
<div class="legal-item"><span class="legal-num">9.4.</span> В случае выявления обмана или недостоверных данных Платформа не несёт ответственности за любые последствия и вправе заблокировать доступ без объяснения причин.</div>

<h2 class="legal-h2">10. Отказ от ответственности платформы</h2>
<div class="legal-item"><span class="legal-num">10.1.</span> Платформа не несёт ответственности за:
  <ul class="legal-list">
    <li>действия пассажиров;</li>
    <li>неоплату поездок;</li>
    <li>отмену заказов;</li>
    <li>конфликты;</li>
    <li>убытки и упущенную выгоду водителя.</li>
  </ul>
</div>
<div class="legal-item"><span class="legal-num">10.2.</span> Платформа не участвует во взаиморасчётах между пользователями.</div>

<h2 class="legal-h2">11. Ограничение доступа</h2>
<div class="legal-item"><span class="legal-num">11.1.</span> Платформа оставляет за собой право ограничить, приостановить или полностью заблокировать доступ пользователя к сервису в любое время.</div>
<div class="legal-item"><span class="legal-num">11.2.</span> Ограничение доступа может применяться без предварительного уведомления и без объяснения причин.</div>
<div class="legal-item"><span class="legal-num">11.3.</span> Блокировка не является отказом от предоставления услуг.</div>
<div class="legal-item"><span class="legal-num">11.4.</span> Платформа вправе ограничить доступ пользователя в случае:
  <ul class="legal-list">
    <li>нарушения правил использования сервиса;</li>
    <li>предоставления недостоверной информации или документов;</li>
    <li>мошеннических действий или обмана других пользователей;</li>
    <li>жалоб от пользователей, которые Платформа сочтёт обоснованными;</li>
    <li>нарушений законодательства государства, на территории которого пользователь осуществляет деятельность;</li>
    <li>иных действий, которые Платформа сочтёт нарушающими интересы сервиса или безопасности пользователей.</li>
  </ul>
</div>
<div class="legal-item"><span class="legal-num">11.5.</span> Платформа может по своему усмотрению восстановить доступ пользователя без обязательства уведомлять или объяснять причину.</div>
<div class="legal-item"><span class="legal-num">11.6.</span> Пользователь соглашается с тем, что он отказывается требовать компенсацию за блокировку или временное ограничение доступа.</div>

<h2 class="legal-h2">12. Споры и меры платформы</h2>
<div class="legal-item"><span class="legal-num">12.1.</span> Все споры с пассажирами решаются Водителем самостоятельно.</div>
<div class="legal-item"><span class="legal-num">12.2.</span> Платформа вправе предоставлять информацию о Водителе, его действиях и заказах по официальному запросу уполномоченных государственных органов в соответствии с применимым законодательством.</div>

<h2 class="legal-h2">13. Изменение условий</h2>
<div class="legal-item"><span class="legal-num">13.1.</span> Платформа вправе изменять настоящее соглашение в любое время без уведомления.</div>
<div class="legal-item"><span class="legal-num">13.2.</span> Продолжение использования означает согласие с изменениями.</div>

<h2 class="legal-h2">14. Заключительные положения</h2>
<div class="legal-item"><span class="legal-num">14.1.</span> Если отдельные положения признаны недействительными, остальные остаются в силе.</div>
<div class="legal-item"><span class="legal-num">14.2.</span> Платформа не организует перевозку и не координирует действия пользователей.</div>
</div>`
  },

  // ---- СОГЛАШЕНИЕ ДЛЯ ПАССАЖИРОВ ----
  passenger: {
    title: 'Соглашение для пассажиров',
    html: `<div class="legal-body">
<div class="legal-doc-header">
  <div class="legal-doc-icon">🧳</div>
  <h1 class="legal-h1">Пользовательское соглашение<br>для пассажиров</h1>
</div>

<h2 class="legal-h2">1. Термины и определения</h2>
<div class="legal-item"><span class="legal-num">1.1.</span> <b>Платформа</b> — сервис (Telegram Mini App), предоставляющий информационные услуги.</div>
<div class="legal-item"><span class="legal-num">1.2.</span> <b>Пассажир</b> — пользователь, размещающий заказы.</div>
<div class="legal-item"><span class="legal-num">1.3.</span> <b>Водитель</b> — пользователь, откликающийся на заказы.</div>
<div class="legal-item"><span class="legal-num">1.4.</span> <b>Заказ</b> — размещённая заявка на поездку.</div>

<h2 class="legal-h2">2. Правовой статус платформы</h2>
<div class="legal-item"><span class="legal-num">2.1.</span> Платформа является исключительно информационной площадкой.</div>
<div class="legal-item"><span class="legal-num">2.2.</span> Платформа <b>не является</b>:
  <ul class="legal-list">
    <li>перевозчиком;</li>
    <li>таксомоторной службой;</li>
    <li>агрегатором такси;</li>
    <li>таксопарком;</li>
    <li>диспетчерской службой;</li>
    <li>агентом (в том числе налоговым агентом), представителем или работодателем водителей.</li>
  </ul>
</div>
<div class="legal-item"><span class="legal-num">2.3.</span> Платформа не оказывает транспортные услуги.</div>
<div class="legal-item"><span class="legal-num">2.4.</span> Все договорённости заключаются напрямую между Пассажиром и Водителем.</div>
<div class="legal-item"><span class="legal-num">2.5.</span> Платформа не является стороной сделки и не является посредником между Пассажиром и Водителем.</div>

<h2 class="legal-h2">3. Функционал сервиса</h2>
<div class="legal-item"><span class="legal-num">3.1.</span> Пассажир самостоятельно:
  <ul class="legal-list">
    <li>размещает заказ;</li>
    <li>указывает маршрут;</li>
    <li>предлагает стоимость поездки;</li>
    <li>выбирает водителя.</li>
  </ul>
</div>
<div class="legal-item"><span class="legal-num">3.2.</span> Водители могут:
  <ul class="legal-list">
    <li>предложить свою услугу;</li>
    <li>предложить свою цену услуги.</li>
  </ul>
</div>
<div class="legal-item"><span class="legal-num">3.3.</span> Платформа не участвует в выборе сторон и не влияет на принятие решений.</div>

<h2 class="legal-h2">4. Права и обязанности пассажира</h2>
<div class="legal-item"><span class="legal-num">4.1.</span> Указывать достоверную и актуальную информацию.</div>
<div class="legal-item"><span class="legal-num">4.2.</span> Не вводить других пользователей в заблуждение.</div>
<div class="legal-item"><span class="legal-num">4.3.</span> Самостоятельно оценивать все риски, связанные с поездкой.</div>
<div class="legal-item"><span class="legal-num">4.4.</span> Соблюдать нормы поведения и требования законодательства государства, на территории которого Пассажир находится и/или осуществляет заказ.</div>
<div class="legal-item"><span class="legal-num">4.5.</span> Пассажир вправе:
  <ul class="legal-list">
    <li>свободно выбирать водителя;</li>
    <li>отказаться от поездки до её начала.</li>
  </ul>
</div>

<h2 class="legal-h2">5. Правила использования</h2>
<div class="legal-item"><span class="legal-num">5.1.</span> Запрещается:
  <ul class="legal-list">
    <li>создавать фиктивные заказы;</li>
    <li>использовать чужие данные;</li>
    <li>совершать мошеннические действия;</li>
    <li>нарушать требования законодательства государства, на территории которого осуществляется заказ.</li>
  </ul>
</div>
<div class="legal-item"><span class="legal-num">5.2.</span> Платформа вправе ограничить или прекратить доступ к сервису при выявлении нарушений без объяснения причин и без какой-либо компенсации.</div>

<h2 class="legal-h2">6. Оплата и данные</h2>
<div class="legal-item"><span class="legal-num">6.1.</span> Оплата поездки осуществляется непосредственно Пассажиром и напрямую Водителю без участия Платформы.</div>
<div class="legal-item"><span class="legal-num">6.2.</span> Платформа не участвует в расчётах между пользователями.</div>
<div class="legal-item"><span class="legal-num">6.3.</span> Платформа не хранит и не обрабатывает платежи за поездки, однако может временно хранить данные о заказах в технических целях.</div>

<h2 class="legal-h2">7. Отказ от ответственности</h2>
<div class="legal-item"><span class="legal-num">7.1.</span> Платформа не несёт ответственности за:
  <ul class="legal-list">
    <li>действия или бездействие водителей;</li>
    <li>безопасность поездки;</li>
    <li>качество услуг;</li>
    <li>техническое состояние транспортного средства;</li>
    <li>причинение вреда жизни, здоровью или имуществу;</li>
    <li>любые нарушения законодательства государства, на территории которого осуществляется заказ.</li>
  </ul>
</div>
<div class="legal-item"><span class="legal-num">7.2.</span> Платформа не гарантирует:
  <ul class="legal-list">
    <li>выполнение заказа;</li>
    <li>наличие водителей;</li>
    <li>достоверность информации.</li>
  </ul>
</div>
<div class="legal-item"><span class="legal-num">7.3.</span> Пассажир использует сервис добровольно, по собственному усмотрению и желанию.</div>

<h2 class="legal-h2">8. Проверка водителей</h2>
<div class="legal-item"><span class="legal-num">8.1.</span> Платформа может запрашивать документы водителей.</div>
<div class="legal-item"><span class="legal-num">8.2.</span> Проверка носит формальный и технический характер.</div>
<div class="legal-item"><span class="legal-num">8.3.</span> Платформа не гарантирует подлинность и достоверность предоставленных данных.</div>
<div class="legal-item"><span class="legal-num">8.4.</span> В случае предоставления водителем недостоверной информации Платформа не несёт ответственности за последствия.</div>

<h2 class="legal-h2">9. Споры и меры платформы</h2>
<div class="legal-item"><span class="legal-num">9.1.</span> Все споры между Пассажиром и Водителем решаются ими самостоятельно.</div>
<div class="legal-item"><span class="legal-num">9.2.</span> Платформа не участвует в урегулировании споров, однако вправе по собственному усмотрению ограничить доступ, включая блокировку Пассажира или Водителя без объяснения причин.</div>
<div class="legal-item"><span class="legal-num">9.3.</span> Платформа вправе предоставлять информацию о пользователях, заказах и иных действиях по официальному запросу уполномоченных государственных органов в соответствии с применимым законодательством.</div>

<h2 class="legal-h2">10. Ограничение ответственности</h2>
<div class="legal-item"><span class="legal-num">10.1.</span> В максимальной степени, допустимой законодательством, Платформа освобождается от любой ответственности.</div>
<div class="legal-item"><span class="legal-num">10.2.</span> Пассажир отказывается от предъявления претензий к Платформе, связанных с использованием сервиса.</div>

<h2 class="legal-h2">11. Ограничение доступа</h2>
<div class="legal-item"><span class="legal-num">11.1.</span> Платформа оставляет за собой право ограничить, приостановить или полностью заблокировать доступ пользователя к сервису в любое время.</div>
<div class="legal-item"><span class="legal-num">11.2.</span> Ограничение доступа может применяться без предварительного уведомления и без объяснения причин.</div>
<div class="legal-item"><span class="legal-num">11.3.</span> Блокировка не является отказом от предоставления услуг.</div>
<div class="legal-item"><span class="legal-num">11.4.</span> Платформа вправе ограничить доступ пользователя в случае:
  <ul class="legal-list">
    <li>нарушения правил использования сервиса;</li>
    <li>предоставления недостоверной информации или документов;</li>
    <li>мошеннических действий или обмана других пользователей;</li>
    <li>жалоб от пользователей, которые Платформа сочтёт обоснованными;</li>
    <li>нарушений законодательства государства, на территории которого пользователь осуществляет деятельность;</li>
    <li>иных действий, которые Платформа сочтёт нарушающими интересы сервиса или безопасности пользователей.</li>
  </ul>
</div>
<div class="legal-item"><span class="legal-num">11.5.</span> Платформа может по своему усмотрению восстановить доступ пользователя без обязательства уведомлять или объяснять причину.</div>
<div class="legal-item"><span class="legal-num">11.6.</span> Пользователь соглашается с тем, что он отказывается требовать компенсацию за блокировку или временное ограничение доступа.</div>

<h2 class="legal-h2">12. Изменение условий</h2>
<div class="legal-item"><span class="legal-num">12.1.</span> Платформа вправе изменять настоящее соглашение в любое время без уведомления.</div>
<div class="legal-item"><span class="legal-num">12.2.</span> Продолжение использования означает согласие с изменениями.</div>

<h2 class="legal-h2">13. Заключительные положения</h2>
<div class="legal-item"><span class="legal-num">13.1.</span> Если отдельные положения признаны недействительными, остальные остаются в силе.</div>
<div class="legal-item"><span class="legal-num">13.2.</span> Платформа не организует перевозку и не координирует действия пользователей.</div>
</div>`
  },

  // ---- ПОЛИТИКА КОНФИДЕНЦИАЛЬНОСТИ ----
  privacy: {
    title: 'Политика конфиденциальности',
    html: `<div class="legal-body">
<div class="legal-doc-header">
  <div class="legal-doc-icon">🔐</div>
  <h1 class="legal-h1">Политика конфиденциальности<br>(Privacy Policy)</h1>
</div>

<h2 class="legal-h2">1. Сбор данных</h2>
<div class="legal-item"><span class="legal-num">1.1.</span> Платформа имеет право собирать следующие данные пользователей:
  <ul class="legal-list">
    <li>имя и контактные данные;</li>
    <li>паспортные данные (удостоверение личности);</li>
    <li>водительское удостоверение;</li>
    <li>технический паспорт транспортного средства;</li>
    <li>регистрационные и разрешительные документы;</li>
    <li>данные о заказах и маршрутах;</li>
    <li>геолокацию;</li>
    <li>технические данные устройства (IP, тип устройства, версия приложения).</li>
  </ul>
</div>
<div class="legal-item"><span class="legal-num">1.2.</span> Данные собираются исключительно для функционирования сервиса и улучшения качества услуг.</div>

<h2 class="legal-h2">2. Использование данных</h2>
<div class="legal-item"><span class="legal-num">2.1.</span> Данные используются для:
  <ul class="legal-list">
    <li>обработки и отображения заказов;</li>
    <li>проверки документов и безопасности пользователей;</li>
    <li>аналитики и улучшения работы сервиса.</li>
  </ul>
</div>
<div class="legal-item"><span class="legal-num">2.2.</span> Платформа не является налоговым агентом и не использует данные для уплаты налогов от имени пользователя.</div>

<h2 class="legal-h2">3. Хранение данных</h2>
<div class="legal-item"><span class="legal-num">3.1.</span> Платформа вправе хранить данные пользователей на срок, который она считает необходимым для работы сервиса и обеспечения безопасности.</div>
<div class="legal-item"><span class="legal-num">3.2.</span> После истечения срока данные могут быть удалены или обезличены.</div>

<h2 class="legal-h2">4. Передача данных третьим лицам</h2>
<div class="legal-item"><span class="legal-num">4.1.</span> Платформа не передаёт данные сторонним коммерческим организациям без согласия пользователя.</div>
<div class="legal-item"><span class="legal-num">4.2.</span> Платформа вправе передавать данные по официальным запросам государственных органов в соответствии с применимым законодательством.</div>

<h2 class="legal-h2">5. Права пользователя</h2>
<div class="legal-item"><span class="legal-num">5.1.</span> Пользователь может запросить исправление или удаление своих данных.</div>
<div class="legal-item"><span class="legal-num">5.2.</span> Для этого необходимо связаться с поддержкой сервиса.</div>

<h2 class="legal-h2">6. Безопасность данных</h2>
<div class="legal-item"><span class="legal-num">6.1.</span> Платформа предпринимает технические и организационные меры для защиты данных от несанкционированного доступа, изменения или раскрытия.</div>
<div class="legal-item"><span class="legal-num">6.2.</span> Пользователь признаёт и соглашается, что Платформа не несёт ответственности за достоверность, сохранность и конфиденциальность данных, включая любые последствия, возникшие в результате:
  <ul class="legal-list">
    <li>несанкционированного доступа третьих лиц;</li>
    <li>технических сбоев;</li>
    <li>действий пользователей или злоумышленников;</li>
    <li>утечек или взлома систем.</li>
  </ul>
</div>
</div>`
  }
};
