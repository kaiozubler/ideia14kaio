/* Vigência dos medicamentos prescritos (tabela medicamentos_em_uso).
   Cada receita grava a data limite do tratamento (data_fim) ou "uso contínuo".
   Este módulo calcula essa data a partir da duração informada na receita e
   monta, para as IAs (anamnese, resumo do prontuário, copiloto), a lista do
   que está em uso HOJE separada do que já terminou — sem isso a IA lia
   "dipirona" de uma receita de 3 anos atrás como medicamento em uso.

   Sem dependências; exposto como window.MedVigencia (e module.exports nos testes). */
(function (global) {
  'use strict';

  const DIAS_POR_UNIDADE = { dias: 1, semanas: 7, meses: 30 };
  const DIA_MS = 86400000;

  function pad(n) { return String(n).padStart(2, '0'); }

  /* Data local (fuso do navegador) em AAAA-MM-DD — toISOString() viraria o dia
     depois das 21h em Brasília. */
  function hojeISO(agora) {
    const d = agora || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function isoParaBR(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
  }

  function isoParaUTC(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
  }

  function somarDias(iso, dias) {
    const t = isoParaUTC(iso);
    if (isNaN(t)) return null;
    const d = new Date(t + dias * DIA_MS);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  function diasEntre(isoA, isoB) {
    return Math.round((isoParaUTC(isoB) - isoParaUTC(isoA)) / DIA_MS);
  }

  /* tipo: 'dias' | 'semanas' | 'meses' | 'uso_continuo' | '' */
  function duracaoEmDias(tipo, valor) {
    const v = Number(String(valor == null ? '' : valor).replace(',', '.'));
    if (!DIAS_POR_UNIDADE[tipo] || !isFinite(v) || v <= 0) return null;
    return Math.round(v * DIAS_POR_UNIDADE[tipo]);
  }

  /* Último dia de uso: o dia de início conta como 1º dia (7 dias a partir de
     hoje terminam daqui a 6 dias), igual ao registro feito pelo Assistente IA. */
  function dataFim(inicioISO, tipo, valor) {
    if (tipo === 'uso_continuo') return null;
    const dias = duracaoEmDias(tipo, valor);
    return dias ? somarDias(inicioISO, dias - 1) : null;
  }

  function duracaoValida(tipo, valor) {
    return tipo === 'uso_continuo' || !!duracaoEmDias(tipo, valor);
  }

  /* Lê a duração escrita na posologia ("... por 7 dias", "uso contínuo"),
     para já deixar o campo preenchido. Só reconhece formas inequívocas. */
  function duracaoDaPosologia(texto) {
    const t = String(texto || '').toLowerCase();
    if (/uso\s+cont[ií]nuo/.test(t)) return { tipo: 'uso_continuo', valor: '' };
    const m = /\b(?:por|durante)\s+(\d{1,3})\s*(dias?|semanas?|m[eê]s(?:es)?)\b/.exec(t);
    if (!m) return null;
    const u = m[2];
    const tipo = u.startsWith('dia') ? 'dias' : u.startsWith('semana') ? 'semanas' : 'meses';
    return { tipo, valor: m[1] };
  }

  function textoDuracao(tipo, valor, inicioISO) {
    if (tipo === 'uso_continuo') return 'Uso contínuo';
    const dias = duracaoEmDias(tipo, valor);
    if (!dias) return '';
    const v = Number(String(valor).replace(',', '.'));
    const unidade = v === 1 ? { dias: 'dia', semanas: 'semana', meses: 'mês' }[tipo] : tipo;
    const fim = dataFim(inicioISO || hojeISO(), tipo, valor);
    return v + ' ' + unidade + (fim ? ' (até ' + isoParaBR(fim) + ')' : '');
  }

  function tempoDecorrido(dias) {
    if (dias <= 0) return 'hoje';
    if (dias === 1) return 'há 1 dia';
    if (dias < 60) return 'há ' + dias + ' dias';
    const meses = Math.round(dias / 30);
    if (meses < 24) return 'há ' + meses + ' meses';
    return 'há ' + Math.floor(dias / 365) + ' anos';
  }

  function chave(nome) {
    return String(nome || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  }

  /* Separa as linhas de medicamentos_em_uso em vigentes e encerradas na data
     de hoje, ficando com a prescrição mais recente de cada medicamento. */
  function classificar(linhas, hoje) {
    hoje = hoje || hojeISO();
    const porNome = new Map();
    for (const l of (Array.isArray(linhas) ? linhas : [])) {
      if (!l || !l.medicamento_nome) continue;
      const k = chave(l.medicamento_nome);
      const atual = porNome.get(k);
      if (!atual || String(l.data_inicio || '') > String(atual.data_inicio || '')) porNome.set(k, l);
    }
    const vigentes = [], encerrados = [];
    for (const l of porNome.values()) {
      const suspenso = l.ativo === false;
      const terminou = !l.uso_continuo && l.data_fim && l.data_fim < hoje;
      const semData = !l.uso_continuo && !l.data_fim;
      if (suspenso || terminou || semData) encerrados.push(l); else vigentes.push(l);
    }
    const porInicioDesc = (a, b) => String(b.data_inicio || '').localeCompare(String(a.data_inicio || ''));
    vigentes.sort(porInicioDesc);
    encerrados.sort(porInicioDesc);
    return { vigentes, encerrados };
  }

  function linhaMed(l, hoje) {
    const nome = [l.medicamento_nome, l.apresentacao].filter(Boolean).join(' — ');
    const pos = l.posologia ? ' — ' + l.posologia : '';
    const inicio = l.data_inicio ? isoParaBR(l.data_inicio) : '';
    const decorrido = l.data_inicio ? tempoDecorrido(diasEntre(l.data_inicio, hoje)) : '';
    if (l.uso_continuo) {
      return '- ' + nome + pos + ' — uso contínuo, prescrito em ' + inicio + ' (' + decorrido + ')';
    }
    if (l.ativo === false) {
      return '- ' + nome + pos + ' — prescrito em ' + inicio + ', suspenso';
    }
    if (!l.data_fim) {
      return '- ' + nome + pos + ' — prescrito em ' + inicio + ' (' + decorrido + '), sem duração registrada';
    }
    const fimTxt = isoParaBR(l.data_fim);
    if (l.data_fim >= hoje) {
      return '- ' + nome + pos + ' — de ' + inicio + ' até ' + fimTxt;
    }
    return '- ' + nome + pos + ' — de ' + inicio + ' até ' + fimTxt + ' (terminou ' + tempoDecorrido(diasEntre(l.data_fim, hoje)) + ')';
  }

  /* Bloco de texto para os prompts. Vazio quando não há prescrição registrada. */
  function textoParaIA(linhas, hoje, maxEncerrados) {
    hoje = hoje || hojeISO();
    const { vigentes, encerrados } = classificar(linhas, hoje);
    if (!vigentes.length && !encerrados.length) return '';
    const limite = maxEncerrados == null ? 15 : maxEncerrados;
    const partes = ['Data de hoje: ' + isoParaBR(hoje)];
    partes.push('Em uso hoje (prescrição vigente):\n' + (vigentes.length ? vigentes.map(l => linhaMed(l, hoje)).join('\n') : '- nenhum'));
    if (encerrados.length) {
      const lista = encerrados.slice(0, limite).map(l => linhaMed(l, hoje));
      if (encerrados.length > limite) lista.push('- … e mais ' + (encerrados.length - limite) + ' tratamento(s) antigo(s)');
      partes.push('Tratamentos ENCERRADOS (histórico — NÃO estão em uso hoje, a menos que a consulta atual confirme o contrário):\n' + lista.join('\n'));
    }
    return partes.join('\n');
  }

  const api = {
    hojeISO, isoParaBR, somarDias, duracaoEmDias, dataFim, duracaoValida,
    duracaoDaPosologia, textoDuracao, classificar, textoParaIA
  };
  global.MedVigencia = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
