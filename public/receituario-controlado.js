/* ============================================================
   RECEITUÁRIO CONTROLADO / COM RETENÇÃO
   Decide, para cada medicamento da receita, qual documento a norma
   exige e coleta, num único modal, os dados obrigatórios que faltam.

   Normas aplicadas:
   - Portaria SVS/MS nº 344/98 (listas A–F e seus adendos), com a
     redação da RDC Anvisa nº 1.000/2025 para receituários;
   - RDC nº 50/2014 (anorexígenos e sibutramina → Notificação B2);
   - RDC nº 11/2011 (talidomida);
   - RDC nº 327/2019 (produtos de Cannabis → Notificação B ou A);
   - RDC nº 471/2021 (antimicrobianos) e RDC nº 973/2025 (agonistas
     de GLP-1): receita em 2 vias com retenção.

   Notificações (A, B, B2, retinoides, talidomida) só têm validade no
   talonário oficial ou, em formato eletrônico, com numeração do SNCR.
   Enquanto o sistema não estiver integrado ao SNCR, o PDF gerado para
   elas é um ESPELHO PARA TRANSCRIÇÃO, sem validade para dispensação.

   Exposto em window.Receituario. Funções puras (classificação,
   doses, extenso) não dependem do DOM e podem ser testadas no Node.
   ============================================================ */
(function (root) {
  'use strict';

  /* Tipos de documento, do mais para o menos restritivo (`ordem`). */
  const TIPOS = {
    PROIBIDO: {
      ordem: 100,
      rotulo: 'Uso proscrito no Brasil (listas E/F) — prescrição proibida',
    },
    NOTIF_A: {
      ordem: 90, notificacao: true, cor: 'amarela',
      rotulo: 'Notificação de Receita "A" (amarela)',
      titulo: 'Notificação de Receita "A"',
      subtitulo: 'Listas A1, A2 e A3 — Portaria SVS/MS nº 344/98',
      validadeDias: 30,
      abrangencia: 'Válida somente na Unidade Federativa que concedeu a numeração.',
      limite: 'Quantidade para no máximo 30 dias de tratamento.',
    },
    NOTIF_TALIDOMIDA: {
      ordem: 85, notificacao: true, cor: 'branca',
      rotulo: 'Notificação de Receita de Talidomida',
      titulo: 'Notificação de Receita de Talidomida',
      subtitulo: 'Lista C3 — RDC Anvisa nº 11/2011',
      validadeDias: 20,
      termo: 'Termo de Responsabilidade/Esclarecimento (RDC nº 11/2011)',
    },
    NOTIF_RETINOIDE: {
      ordem: 80, notificacao: true, cor: 'branca',
      rotulo: 'Notificação de Receita Especial — retinoide sistêmico (branca)',
      titulo: 'Notificação de Receita Especial — Retinoides',
      subtitulo: 'Lista C2 (uso sistêmico) — Portaria SVS/MS nº 344/98',
      validadeDias: 30,
      limite: 'Quantidade para no máximo 30 dias de tratamento.',
      termo: 'Termo de Conhecimento de Risco e Consentimento Pós-Informação (retinoides sistêmicos)',
    },
    NOTIF_B2: {
      ordem: 75, notificacao: true, cor: 'azul',
      rotulo: 'Notificação de Receita "B2" (azul)',
      titulo: 'Notificação de Receita "B2"',
      subtitulo: 'Psicotrópicos anorexígenos — RDC Anvisa nº 50/2014',
      validadeDias: 30,
      abrangencia: 'Válida somente na Unidade Federativa que concedeu a numeração.',
      limite: 'Quantidade para no máximo 30 dias de tratamento.',
      termo: 'Termo de Responsabilidade do Prescritor (RDC nº 50/2014)',
    },
    NOTIF_B: {
      ordem: 70, notificacao: true, cor: 'azul',
      rotulo: 'Notificação de Receita "B" (azul)',
      titulo: 'Notificação de Receita "B"',
      subtitulo: 'Lista B1 — Portaria SVS/MS nº 344/98',
      validadeDias: 30,
      abrangencia: 'Válida somente na Unidade Federativa que concedeu a numeração.',
      limite: 'Quantidade para no máximo 60 dias de tratamento.',
    },
    CE: {
      ordem: 50, retida: true,
      rotulo: 'Receita de Controle Especial (2 vias)',
      titulo: 'Receita de Controle Especial',
      validadeDias: 30,
      via1: '1ª via — Retenção da farmácia',
      via2: '2ª via — Paciente',
      limite: 'Quantidade para até 60 dias de tratamento (antiparkinsonianos e anticonvulsivantes: até 6 meses); injetáveis: até 5 ampolas.',
      norma: 'Portaria SVS/MS nº 344/98',
    },
    RET_ATM: {
      ordem: 30, retida: true,
      rotulo: 'Antimicrobiano — receita em 2 vias com retenção',
      titulo: 'Receita de Antimicrobiano',
      validadeDias: 10,
      via1: '1ª via — Paciente',
      via2: '2ª via — Retenção da farmácia',
      norma: 'RDC Anvisa nº 471/2021',
      exigeSexo: true,
    },
    RET_GLP1: {
      ordem: 25, retida: true,
      rotulo: 'Agonista de GLP-1 — receita em 2 vias com retenção',
      titulo: 'Receita — Agonista do receptor de GLP-1',
      validadeDias: 90,
      via1: '1ª via — Paciente',
      via2: '2ª via — Retenção da farmácia',
      norma: 'RDC Anvisa nº 471/2021, alterada pela RDC nº 973/2025',
    },
    COMUM: { ordem: 0, rotulo: '' },
  };

  /* Pendência do adendo da lista A2: depende da dose por unidade. */
  const DUVIDA_A2 = 'DUVIDA_A2';

  const norm = (s) => String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const temPalavra = (txt, palavra) =>
    new RegExp('(^|[^A-Z0-9])' + palavra + '($|[^A-Z0-9])').test(txt);
  const nomesSubstancia = (s) =>
    norm([s.nome_dcb, s.grupo_busca, s.nome_exibicao, s.nome].filter(Boolean).join(' | '));

  /* Formas de uso tópico nas apresentações (padrão CMED: "CREM DERM",
     "GEL DERM", "SOL TOP"...). Usado só para o adendo da lista C2. */
  function ehTopico(apresentacao) {
    const t = norm(apresentacao);
    return /(^|[^A-Z])(DERM|TOP|CAPIL)([^A-Z]|$)/.test(t)
      || /(CREME|POMADA|LOCAO|GEL DERMATOLOGICO|USO TOPICO)/.test(t);
  }

  /* Lê as doses por unidade posológica no início da apresentação
     ("50 MG COM..." → [50]; "500 MG + 30 MG COM..." → [500, 30]).
     Devolve null quando não dá para afirmar a dose por unidade
     (concentrações "MG/ML", percentuais ou texto sem dose). */
  function dosesMg(apresentacao) {
    const t = norm(apresentacao).trim();
    const m = t.match(/^((?:[\d.,]+\s*(?:MG|MCG|G)\b\s*\+?\s*)+)/);
    if (!m) return null;
    const resto = t.slice(m[0].length);
    if (/^\s*(\/|%)/.test(resto) || /\/\s*(ML|G|L)\b/.test(m[1])) return null;
    const doses = [];
    for (const x of m[1].matchAll(/([\d.,]+)\s*(MG|MCG|G)\b/g)) {
      let num = x[1];
      if (num.includes(',')) num = num.replace(/\./g, '').replace(',', '.');
      else if (/^\d{1,3}(\.\d{3})+$/.test(num)) num = num.replace(/\./g, '');
      let v = parseFloat(num);
      if (!isFinite(v)) return null;
      if (x[2] === 'G') v *= 1000;
      if (x[2] === 'MCG') v /= 1000;
      doses.push(v);
    }
    return doses.length ? doses : null;
  }

  /* Categoria exigida por UMA substância, dado o contexto do item. */
  function categoriaSubstancia(s, apresentacao) {
    const nomes = nomesSubstancia(s);
    const lista = norm(s.lista_portaria344).trim();

    // Produtos de Cannabis (RDC 327/2019): Notificação B se THC ≤ 0,2%,
    // Notificação A se THC > 0,2% (cuidados paliativos). O médico confirma.
    if (/CANABI|CANNABIS|TETRAIDROCANABINOL/.test(nomes)) {
      return { cat: 'NOTIF_B', cannabis: true, motivo: 'Produto de Cannabis (RDC nº 327/2019)' };
    }
    // Sibutramina: Notificação B2 + termo do prescritor (RDC 50/2014).
    if (temPalavra(nomes, 'SIBUTRAMINA')) {
      return { cat: 'NOTIF_B2', motivo: 'Sibutramina (RDC nº 50/2014)' };
    }
    if (['E', 'F1', 'F2', 'F3'].includes(lista)) return { cat: 'PROIBIDO', motivo: 'Lista ' + lista };

    // Adendo da lista A2: codeína, di-hidrocodeína e tramadol com até
    // 100 mg por unidade posológica → Receita de Controle Especial.
    if (lista === 'A2' && ['CODEINA', 'DIIDROCODEINA', 'DI-HIDROCODEINA', 'TRAMADOL'].some(n => temPalavra(nomes, n))) {
      const doses = dosesMg(apresentacao);
      if (doses && doses.every(d => d <= 100)) {
        return { cat: 'CE', motivo: 'Adendo da lista A2 (até 100 mg por unidade posológica)' };
      }
      if (doses && doses.length === 1) return { cat: 'NOTIF_A', motivo: 'Lista A2 (acima de 100 mg por unidade)' };
      return { cat: DUVIDA_A2, motivo: 'Lista A2 — depende da dose por unidade posológica' };
    }
    if (['A1', 'A2', 'A3'].includes(lista)) return { cat: 'NOTIF_A', motivo: 'Lista ' + lista };

    // Adendo da lista B1: barbitúricos anticonvulsivantes em Receita de
    // Controle Especial.
    if (lista === 'B1' && ['FENOBARBITAL', 'METILFENOBARBITAL', 'BARBEXACLONA', 'BARBITAL'].some(n => temPalavra(nomes, n))) {
      return { cat: 'CE', motivo: 'Adendo da lista B1 (anticonvulsivante)' };
    }
    if (lista === 'B1') return { cat: 'NOTIF_B', motivo: 'Lista B1' };
    if (lista === 'B2') return { cat: 'NOTIF_B2', motivo: 'Lista B2' };
    if (lista === 'C2') {
      return ehTopico(apresentacao)
        ? { cat: 'CE', motivo: 'Retinoide de uso tópico (adendo da lista C2)' }
        : { cat: 'NOTIF_RETINOIDE', motivo: 'Lista C2 (uso sistêmico)' };
    }
    if (lista === 'C3') return { cat: 'NOTIF_TALIDOMIDA', motivo: 'Lista C3' };
    if (['C1', 'C4', 'C5'].includes(lista)) return { cat: 'CE', motivo: 'Lista ' + lista };

    const ret = norm(s.retencao_receita).trim();
    if (ret === 'GLP1') return { cat: 'RET_GLP1', motivo: 'Agonista de GLP-1' };
    if (ret === 'ANTIMICROBIANO') return { cat: 'RET_ATM', motivo: 'Antimicrobiano' };
    // D1/D2 e substâncias sem controle: receita comum, sem retenção.
    return { cat: 'COMUM', motivo: lista ? 'Lista ' + lista + ' (sem retenção)' : '' };
  }

  const ordemDe = (cat) => (cat === DUVIDA_A2 ? TIPOS.NOTIF_A.ordem - 1 : (TIPOS[cat] || TIPOS.COMUM).ordem);

  /* Classifica um item ({ apresentacao, substancias: [...] }). Fica com a
     categoria mais restritiva entre as substâncias (associações). */
  function classificarItem(item) {
    const subs = (item && item.substancias) || [];
    let melhor = { cat: 'COMUM', motivo: '' };
    let cannabis = false;
    const proibidas = [];
    for (const s of subs) {
      const c = categoriaSubstancia(s, item.apresentacao || '');
      if (c.cannabis) cannabis = true;
      if (c.cat === 'PROIBIDO') proibidas.push(s.nome_exibicao || s.nome_dcb || s.nome || '');
      if (ordemDe(c.cat) > ordemDe(melhor.cat)) melhor = c;
    }
    // Em produto de Cannabis, o THC (lista F2) não torna a prescrição
    // proibida: vale a regra própria da RDC 327/2019.
    if (cannabis && (melhor.cat === 'PROIBIDO' || ordemDe(melhor.cat) < TIPOS.NOTIF_B.ordem)) {
      melhor = { cat: 'NOTIF_B', cannabis: true, motivo: 'Produto de Cannabis (RDC nº 327/2019)' };
    } else if (cannabis) {
      melhor = Object.assign({}, melhor, { cannabis: true });
    }
    return Object.assign({ proibidas }, melhor);
  }

  /* ── Quantidade por extenso (Portaria 344: algarismos e extenso) ── */
  const UNI_M = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove',
    'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  const DEZ = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  const CEN_M = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

  function ate999(n, fem) {
    const uni = (u) => (fem && u === 1 ? 'uma' : fem && u === 2 ? 'duas' : UNI_M[u]);
    const cen = (c) => (fem && c > 1 ? CEN_M[c].replace(/os$/, 'as') : CEN_M[c]);
    if (n === 100) return 'cem';
    const c = Math.floor(n / 100), r = n % 100, partes = [];
    if (c) partes.push(cen(c));
    if (r) {
      if (r < 20) partes.push(uni(r));
      else {
        const d = Math.floor(r / 10), u = r % 10;
        partes.push(u ? DEZ[d] + ' e ' + uni(u) : DEZ[d]);
      }
    }
    return partes.join(' e ');
  }

  function numeroPorExtenso(n, fem) {
    n = Math.floor(Number(n));
    if (!isFinite(n) || n < 0 || n > 999999) return '';
    if (n === 0) return 'zero';
    const mil = Math.floor(n / 1000), resto = n % 1000;
    const partes = [];
    if (mil) partes.push(mil === 1 ? 'mil' : ate999(mil, false) + ' mil');
    if (resto) partes.push(ate999(resto, fem));
    if (mil && resto && (resto < 100 || resto % 100 === 0)) return partes.join(' e ');
    return partes.join(' ');
  }

  const UNIDADES_FEM = /^(CAIXA|AMPOLA|CAPSULA|DRAGEA|GOTA|UNIDADE|BISNAGA|SERINGA|CANETA|PASTILHA|BOLSA|CARTELA|EMBALAGEM|SUSPENSAO|SOLUCAO|FRASCO-AMPOLA)/;

  /* "2 caixas" → "2 (duas) caixas". Texto sem número inicial volta igual
     (o modal de requisitos impede que item controlado chegue assim). */
  function quantidadePorExtenso(qtd) {
    const t = String(qtd || '').trim();
    const m = t.match(/^(\d{1,6})(\s*)(.*)$/);
    if (!m) return t;
    if (/^\s*\(/.test(m[3])) return t; // já está por extenso
    const fem = UNIDADES_FEM.test(norm(m[3]).trim());
    return m[1] + ' (' + numeroPorExtenso(parseInt(m[1], 10), fem) + ')' + (m[3] ? ' ' + m[3] : '');
  }

  const temNumeroInicial = (qtd) => /^\s*\d/.test(String(qtd || ''));

  /* ── Modal de requisitos legais ─────────────────────────────── */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const enderecoDoPaciente = (p) => {
    const partes = [p.logradouro, p.numero, p.bairro, p.cidade, p.uf].filter(Boolean).join(', ');
    const end = partes || p.endereco || p.end || '';
    return end === '—' ? '' : end;
  };

  /* Pede, de uma vez, tudo o que a norma exige e ainda falta para os
     itens classificados. Resolve com { endereco, sexo, itens } (itens já
     com `controle` final, `numero_notificacao` e quantidade ajustada) ou
     null se o médico cancelar. Itens comuns passam direto. */
  function abrirModalRequisitos({ itens, paciente }) {
    const p = paciente || {};
    const controlados = itens.filter(it => it.controle && it.controle.cat !== 'COMUM');
    const exigeEndereco = controlados.some(it => it.controle.cat === 'CE' || it.controle.cat === DUVIDA_A2 || (TIPOS[it.controle.cat] || {}).notificacao);
    const exigeSexo = controlados.some(it => (TIPOS[it.controle.cat] || {}).exigeSexo);
    const enderecoAtual = enderecoDoPaciente(p);
    const sexoAtual = p.sexo || '';

    const linhas = controlados.map((it, i) => {
      const c = it.controle;
      const tipo = TIPOS[c.cat] || {};
      // Fórmulas já trazem a quantidade a manipular validada no formulário.
      const pedeQtd = c.cat !== 'RET_ATM' && c.cat !== 'RET_GLP1' && it.tipo !== 'formula';
      const ehNotif = tipo.notificacao || c.cat === DUVIDA_A2;
      let html = `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;margin-bottom:8px">
        <div style="font-size:12.5px;font-weight:700;color:#0f172a">${esc(it.nome)}${it.apresentacao ? ` <span style="font-weight:400;color:#64748b">${esc(it.apresentacao)}</span>` : ''}</div>
        <div style="font-size:11px;color:#9a3412;margin:2px 0 6px">${c.cat === DUVIDA_A2 ? esc(c.motivo) : esc(tipo.rotulo) + (c.motivo ? ' · ' + esc(c.motivo) : '')}</div>`;
      if (c.cat === DUVIDA_A2) {
        html += `<label style="display:block;font-size:11px;font-weight:600;color:#334155;margin-bottom:3px">Quantidade de ${esc(it.nome)} por unidade posológica (comprimido, cápsula, ampola…)</label>
          <select data-k="a2" data-i="${i}" style="width:100%;padding:7px 10px;border:1px solid #cbd5e1;border-radius:7px;font-size:12px;margin-bottom:6px">
            <option value="">Selecione…</option>
            <option value="CE">Até 100 mg → Receita de Controle Especial (adendo da lista A2)</option>
            <option value="NOTIF_A">Acima de 100 mg → Notificação de Receita "A"</option>
          </select>`;
      }
      if (c.cannabis) {
        html += `<label style="display:block;font-size:11px;font-weight:600;color:#334155;margin-bottom:3px">Teor de THC do produto (RDC nº 327/2019)</label>
          <select data-k="thc" data-i="${i}" style="width:100%;padding:7px 10px;border:1px solid #cbd5e1;border-radius:7px;font-size:12px;margin-bottom:6px">
            <option value="NOTIF_B">Até 0,2% de THC → Notificação de Receita "B"</option>
            <option value="NOTIF_A">Acima de 0,2% de THC (cuidados paliativos) → Notificação de Receita "A"</option>
          </select>`;
      }
      if (pedeQtd) {
        html += `<label style="display:block;font-size:11px;font-weight:600;color:#334155;margin-bottom:3px">Quantidade (em algarismos — o extenso é gerado no documento)</label>
          <input data-k="qtd" data-i="${i}" type="text" value="${esc(it.quantidade || '')}" placeholder="Ex.: 2 caixas, 30 comprimidos"
            style="width:100%;padding:7px 10px;border:1px solid #cbd5e1;border-radius:7px;font-size:12px;margin-bottom:6px" />`;
      }
      if (ehNotif) {
        html += `<label style="display:block;font-size:11px;font-weight:600;color:#334155;margin-bottom:3px">Número da notificação (do seu talonário oficial)${c.cat === DUVIDA_A2 ? ' — só se for Notificação "A"' : ''}</label>
          <input data-k="num" data-i="${i}" type="text" placeholder="Número impresso no talonário" autocomplete="off"
            style="width:100%;padding:7px 10px;border:1px solid #cbd5e1;border-radius:7px;font-size:12px;margin-bottom:6px" />`;
      }
      if (tipo.termo) {
        html += `<label style="display:flex;gap:7px;align-items:flex-start;font-size:11.5px;color:#334155;cursor:pointer">
            <input data-k="termo" data-i="${i}" type="checkbox" style="margin-top:2px" />
            <span>O <strong>${esc(tipo.termo)}</strong> será preenchido e assinado no modelo oficial e entregue junto com a notificação.</span>
          </label>`;
      }
      return html + '</div>';
    }).join('');

    const temNotif = controlados.some(it => (TIPOS[it.controle.cat] || {}).notificacao || it.controle.cat === DUVIDA_A2);

    // Só retenção simples (antimicrobiano/GLP-1) com o sexo já conhecido:
    // nada a perguntar, segue direto.
    const soRetencao = controlados.every(it => it.controle.cat === 'RET_ATM' || it.controle.cat === 'RET_GLP1');
    if (soRetencao && (!exigeSexo || sexoAtual)) {
      return Promise.resolve({ endereco: enderecoAtual, sexo: sexoAtual, itens });
    }

    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
      overlay.innerHTML = `
        <div style="background:#fff;border-radius:14px;max-width:560px;width:100%;max-height:calc(100vh - 32px);overflow:auto;padding:20px 22px;box-shadow:0 20px 60px rgba(0,0,0,.25)">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <i class="ti ti-shield-check" style="font-size:20px;color:#ca8a04"></i>
            <h3 style="font-size:15px;font-weight:700;color:#0f172a;margin:0">Requisitos legais da receita</h3>
          </div>
          <p style="font-size:12px;color:#475569;line-height:1.5;margin:0 0 12px">
            Os itens abaixo exigem receituário especial. Cada tipo de documento sai em um PDF próprio,
            separado da receita comum, para que a farmácia retenha só o que a norma manda.
          </p>
          ${temNotif ? `<div style="font-size:11.5px;line-height:1.5;color:#854d0e;background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:8px 10px;margin-bottom:12px">
            <strong>Notificações de receita:</strong> só valem no talonário oficial ou, em formato eletrônico,
            com numeração do SNCR (RDC nº 1.000/2025). Este sistema ainda não está integrado ao SNCR: para cada
            notificação será gerado um <strong>espelho para transcrição</strong> no talonário, sem validade para
            dispensação. A receita que acompanha a notificação sai normalmente.
          </div>` : ''}
          ${exigeEndereco ? `<label style="display:block;font-size:11px;font-weight:700;color:#334155;margin-bottom:4px">Endereço completo do paciente *</label>
            <input data-k="endereco" type="text" value="${esc(enderecoAtual)}" placeholder="Rua, número, bairro, cidade/UF"
              style="width:100%;padding:8px 11px;border:1px solid #cbd5e1;border-radius:8px;font-size:12.5px;margin-bottom:10px" />` : ''}
          ${exigeSexo ? `<label style="display:block;font-size:11px;font-weight:700;color:#334155;margin-bottom:4px">Sexo do paciente * <span style="font-weight:400;color:#64748b">(obrigatório na receita de antimicrobiano)</span></label>
            <select data-k="sexo" style="width:100%;padding:8px 11px;border:1px solid #cbd5e1;border-radius:8px;font-size:12.5px;margin-bottom:10px">
              <option value="">Selecione…</option>
              ${['Feminino', 'Masculino'].map(s => `<option ${norm(sexoAtual).startsWith(norm(s).charAt(0)) && sexoAtual ? 'selected' : ''}>${s}</option>`).join('')}
            </select>` : ''}
          ${linhas}
          <div data-k="erro" style="display:none;font-size:11.5px;color:#b91c1c;margin:4px 0 8px"></div>
          <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:10px">
            <button data-k="cancelar" style="padding:9px 16px;border-radius:8px;border:1px solid #e2e8f0;background:#fff;color:#475569;font-size:13px;cursor:pointer">Cancelar</button>
            <button data-k="confirmar" style="padding:9px 16px;border-radius:8px;border:none;background:#0E6E5D;color:#fff;font-size:13px;font-weight:600;cursor:pointer">Confirmar e gerar</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const q = (sel) => overlay.querySelector(sel);
      const qa = (sel) => Array.from(overlay.querySelectorAll(sel));
      const finish = (val) => { overlay.remove(); resolve(val); };
      q('[data-k="cancelar"]').onclick = () => finish(null);

      q('[data-k="confirmar"]').onclick = () => {
        const erros = [];
        const marca = (el) => { if (el) el.style.borderColor = '#dc2626'; };
        qa('input,select').forEach(el => { el.style.borderColor = '#cbd5e1'; });

        const endEl = q('[data-k="endereco"]');
        const endereco = endEl ? endEl.value.trim() : enderecoAtual;
        if (endEl && !endereco) { erros.push('endereço do paciente'); marca(endEl); }
        const sexoEl = q('[data-k="sexo"]');
        const sexo = sexoEl ? sexoEl.value : sexoAtual;
        if (sexoEl && !sexo) { erros.push('sexo do paciente'); marca(sexoEl); }

        const resolvidos = controlados.map((it, i) => {
          const r = Object.assign({}, it, { controle: Object.assign({}, it.controle) });
          const a2 = q(`[data-k="a2"][data-i="${i}"]`);
          if (a2) {
            if (!a2.value) { erros.push('dose por unidade de ' + it.nome); marca(a2); }
            else r.controle.cat = a2.value;
          }
          const thc = q(`[data-k="thc"][data-i="${i}"]`);
          if (thc) r.controle.cat = thc.value;
          const qtd = q(`[data-k="qtd"][data-i="${i}"]`);
          if (qtd) {
            r.quantidade = qtd.value.trim();
            if (!temNumeroInicial(r.quantidade)) { erros.push('quantidade em algarismos de ' + it.nome); marca(qtd); }
          }
          const num = q(`[data-k="num"][data-i="${i}"]`);
          // A notificação só existe se o item ficou numa categoria de notificação.
          if (num && (TIPOS[r.controle.cat] || {}).notificacao) {
            r.numero_notificacao = num.value.trim();
            if (!r.numero_notificacao) { erros.push('número da notificação de ' + it.nome); marca(num); }
          }
          const termo = q(`[data-k="termo"][data-i="${i}"]`);
          if (termo && !termo.checked) { erros.push('confirmação do termo de ' + it.nome); }
          return r;
        });

        // Notificações não podem repetir número (uma por substância).
        const nums = resolvidos.map(r => r.numero_notificacao).filter(Boolean);
        if (new Set(nums).size !== nums.length) erros.push('números de notificação distintos (uma notificação por medicamento)');

        if (erros.length) {
          const box = q('[data-k="erro"]');
          box.textContent = 'Preencha: ' + erros.join('; ') + '.';
          box.style.display = 'block';
          return;
        }
        let k = 0;
        const itensFinal = itens.map(it => (it.controle && it.controle.cat !== 'COMUM') ? resolvidos[k++] : it);
        finish({ endereco, sexo, itens: itensFinal });
      };
    });
  }

  root.Receituario = {
    TIPOS, DUVIDA_A2,
    classificarItem, categoriaSubstancia, dosesMg, ehTopico,
    numeroPorExtenso, quantidadePorExtenso, temNumeroInicial,
    enderecoDoPaciente, abrirModalRequisitos,
  };
})(typeof window !== 'undefined' ? window : globalThis);
