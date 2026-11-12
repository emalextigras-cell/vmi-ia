/**
 * Aide au réglage : observations prudentes, sans pilotage automatique.
 * Les comparaisons par vitesse restent descriptives (météo et usages non contrôlés).
 */
export function renderRegulationAdvice(data, options) {
  const { target, minSamples, median, absoluteHumidity, fmt } = options;
  const valid = data.filter(r =>
    Number.isFinite(r.st) && Number.isFinite(r.sh) &&
    Number.isFinite(r.te) && Number.isFinite(r.he)
  );
  const recent = valid.slice(-Math.min(24, valid.length));
  let recommendation = '';

  if (!recent.length) {
    recommendation = 'Aucune mesure exploitable pour le moment. Connecte la VMI et laisse-la relever les capteurs, ou sélectionne un historique contenant température et humidité du salon et de l’air entrant.';
  } else {
    const rh = median(recent.map(r => r.sh));
    const haSalon = median(recent.map(r => absoluteHumidity(r.st, r.sh)));
    const haEntrant = median(recent.map(r => absoluteHumidity(r.te, r.he)));
    const delta = haSalon != null && haEntrant != null ? haSalon - haEntrant : null;
    const above = rh > target + 5;
    const below = rh < target - 5;

    recommendation = '<strong>Lecture des dernières mesures</strong><br>' +
      'Humidité du salon : <b>' + fmt(rh) + ' %</b> (objectif indicatif : ' + target + ' %).' +
      (haSalon != null ? '<br>Humidité absolue : <b>' + fmt(haSalon) + ' g/m³</b>.' : '');

    if (above) {
      recommendation += '<br><br><b>Humidité au-dessus de l’objectif.</b> Vérifie d’abord les sources de vapeur (douches, cuisine, linge), les entrées d’air, les bouches d’extraction et le filtre.';
    } else if (below) {
      recommendation += '<br><br><b>Humidité sous l’objectif.</b> Ces mesures ne donnent pas de raison hygrométrique d’augmenter la ventilation.';
    } else {
      recommendation += '<br><br><b>Humidité proche de l’objectif.</b> Évite de changer la vitesse sur la base de quelques relevés.';
    }

    if (delta != null) {
      if (delta > 1) {
        recommendation += '<br><br>L’air entrant est plus sec que l’air intérieur d’environ <b>' + fmt(delta) + ' g/m³</b>. Le renouvellement d’air a donc un potentiel d’assèchement à cet instant.';
        if (above) recommendation += ' Si l’humidité reste élevée plusieurs jours, tu peux tester manuellement la vitesse supérieure pendant une période comparable, puis revenir à la vitesse précédente si le résultat n’est pas meilleur.';
      } else if (delta < -1) {
        recommendation += '<br><br>L’air entrant est plus humide d’environ <b>' + fmt(Math.abs(delta)) + ' g/m³</b>. Augmenter la vitesse ne garantit pas d’assécher le logement ; ne le fais pas uniquement pour faire baisser l’humidité.';
      } else {
        recommendation += '<br><br>L’air entrant et l’air intérieur ont des humidités absolues proches : l’effet asséchant potentiel est faible à cet instant.';
      }
    }
    recommendation += '<br><br><span class="note">Conseil indicatif : les mesures décrivent une situation, elles ne prouvent pas à elles seules qu’une vitesse est meilleure.</span>';
  }

  const speedRows = data.filter(r =>
    Number.isFinite(r.vit) && r.vit >= 1 && r.vit <= 3 &&
    Number.isFinite(r.st) && Number.isFinite(r.sh)
  );
  const groups = [1, 2, 3].map(v => {
    const rows = speedRows.filter(r => r.vit === v);
    const times = rows.map(r => r.t).filter(Number.isFinite);
    const spanHours = times.length > 1 ? (Math.max(...times) - Math.min(...times)) / 3600000 : 0;
    return {
      v, n: rows.length, spanHours,
      rh: median(rows.map(r => r.sh)),
      ha: median(rows.map(r => absoluteHumidity(r.st, r.sh))),
      delta: median(rows.map(r => {
        const inside = absoluteHumidity(r.st, r.sh);
        const outside = absoluteHumidity(r.te, r.he);
        return inside != null && outside != null ? inside - outside : null;
      }))
    };
  });

  const codeRows = data.filter(r => Number.isFinite(r.vitCode) && Number.isFinite(r.st) && Number.isFinite(r.sh));
  const rawCodes = [...new Set(codeRows.map(r => r.vitCode))].sort((a, b) => a - b);
  let codeTable = '';
  if (rawCodes.length) {
    codeTable = '<h4>Codes « Vitesse » de l’export VMI+</h4><table><thead><tr><th>Code export</th><th>Relevés</th><th>HR médiane</th><th>HA salon</th></tr></thead><tbody>';
    for (const code of rawCodes) {
      const rows = codeRows.filter(r => r.vitCode === code);
      codeTable += '<tr><td>' + code + '</td><td>' + rows.length + '</td><td>' +
        fmt(median(rows.map(r => r.sh))) + ' %</td><td>' +
        fmt(median(rows.map(r => absoluteHumidity(r.st, r.sh)))) + ' g/m³</td></tr>';
    }
    codeTable += '</tbody></table><p class="note">Ces valeurs sont les codes bruts de l’export. Leur correspondance avec les boutons manuels 1, 2 et 3 n’est pas établie : elles ne sont donc pas présentées comme des vitesses manuelles.</p>';
  }

  let table = '<table><thead><tr><th>Vitesse</th><th>Relevés</th><th>Durée couverte</th><th>HR médiane</th><th>HA salon</th><th>Écart HA*</th></tr></thead><tbody>';
  for (const g of groups) {
    table += '<tr><td>' + g.v + '</td><td>' + g.n + '</td><td>' +
      (g.spanHours ? (g.spanHours < 24 ? fmt(g.spanHours) + ' h' : fmt(g.spanHours / 24) + ' j') : '—') +
      '</td><td>' + (g.rh == null ? '—' : fmt(g.rh) + ' %') +
      '</td><td>' + (g.ha == null ? '—' : fmt(g.ha) + ' g/m³') +
      '</td><td>' + (g.delta == null ? '—' : fmt(g.delta) + ' g/m³') + '</td></tr>';
  }
  table += '</tbody></table><p class="note">* Écart d’humidité absolue salon − air entrant. Un chiffre positif signifie que l’air entrant est plus sec.</p>';

  const enough = groups.filter(g => g.n >= minSamples && g.spanHours >= 12);
  let comparison = '';
  if (!speedRows.length) {
    comparison = rawCodes.length
      ? 'L’export contient des codes de vitesse, mais leur correspondance avec les trois boutons manuels n’est pas connue. Les données permettent de décrire ces codes, pas de désigner la vitesse manuelle 1, 2 ou 3. Pour établir la correspondance, il faudra observer les codes pendant un changement manuel de vitesse.'
      : 'Aucun relevé ne contient de vitesse exploitable. Connecte la VMI et laisse l’application enregistrer des relevés en direct avec l’état de vitesse reçu.';
  } else if (enough.length < 3) {
    comparison = 'Comparaison encore incomplète : pour comparer les trois vitesses, chacune doit avoir au moins ' + minSamples + ' relevés répartis sur au moins 12 heures. Les données actuelles ne permettent pas de désigner une meilleure vitesse.';
  } else {
    const candidates = enough.filter(g => g.rh != null && g.rh <= target + 5 && g.delta != null && g.delta > 0.5);
    if (candidates.length) {
      comparison = 'Les trois vitesses sont documentées. La vitesse ' + Math.min(...candidates.map(g => g.v)) +
        ' est une piste à vérifier : l’humidité observée est proche ou sous l’objectif et l’air entrant était plus sec en médiane. Ce n’est pas une preuve qu’elle est optimale : compare des périodes de météo et d’usage similaires.';
    } else {
      comparison = 'Les trois vitesses sont documentées, mais aucune ne réunit clairement les critères indicatifs (humidité proche de l’objectif et air entrant plus sec). Ne change pas la vitesse sur cette seule comparaison.';
    }
  }

  return { recommendation, speedAnalysis: codeTable + table + '<div class="advice">' + comparison + '</div>' };
}
