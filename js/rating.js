/* ============================================================
   RATING — Stars rating system with complaints
   ============================================================ */

function openRatingModal(ratingFor, orderId) {
  STATE.ratingFor = ratingFor;
  STATE.ratingOrderId = orderId;
  STATE.currentRating = 0;

  _setText('rating-title', ratingFor === 'driver' ? 'Оцените водителя' : 'Оцените пассажира');
  _setText('rating-sub', ratingFor === 'driver' ? 'Как вам водитель?' : 'Как вам пассажир?');
  document.querySelectorAll('.sbtn').forEach(b => b.classList.remove('lit'));
  _setVal('rating-comment', '');
  const cc = document.getElementById('complaint-check');
  if (cc) cc.checked = false;
  const cw = document.getElementById('complaint-wrap');
  if (cw) cw.style.display = 'none';
  openModal('mo-rating');
}

function setStar(v) {
  STATE.currentRating = v;
  document.querySelectorAll('.sbtn').forEach(b =>
    b.classList.toggle('lit', parseInt(b.dataset.v) <= v)
  );
}

async function submitRating() {
  if (!STATE.currentRating) { showToast('Поставьте оценку', 'err'); return; }
  const comment = document.getElementById('rating-comment').value.trim();
  const hasComplaint = document.getElementById('complaint-check').checked;
  const complaint = hasComplaint ? document.getElementById('complaint-text').value.trim() : '';

  await dbSet('ratings', 'RAT-' + Date.now(), {
    orderId: STATE.ratingOrderId,
    ratingFor: STATE.ratingFor,
    stars: STATE.currentRating,
    comment,
    complaint,
    by: STATE.uid,
    createdAt: new Date().toISOString()
  });

  // Update rated user's rating
  try {
    const order = await dbGet('orders', STATE.ratingOrderId);
    if (order) {
      let targetId = null;
      if (STATE.ratingFor === 'driver' && order.acceptedDriver) {
        targetId = order.acceptedDriver.driverId;
      } else if (STATE.ratingFor === 'passenger') {
        targetId = order.passengerId;
      }
      if (targetId) {
        const targetUser = await dbGet('users', targetId);
        if (targetUser) {
          const nc = (targetUser.ratingCount || 0) + 1;
          const newRating = ((targetUser.rating || 5) * (nc - 1) + STATE.currentRating) / nc;
          await dbSet('users', targetId, {
            rating: Math.round(newRating * 10) / 10,
            ratingCount: nc
          });
        }
      }
    }
  } catch (e) { console.warn('[rating] update error:', e); }

  closeModal('mo-rating');
  showToast('Спасибо за оценку! ⭐', 'ok');
}
