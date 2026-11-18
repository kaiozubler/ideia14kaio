/* Documentos do processo do LME (CEAF) por estado.
   A base é a regra federal (Portaria de Consolidação GM/MS nº 2/2017, Anexo XXVIII,
   Título IV, art. 69, resumida pelo Ministério da Saúde); cada Secretaria Estadual
   acrescenta exigências próprias. Só entram aqui regras lidas na fonte oficial
   indicada em `fontes`; UF sem levantamento fica com a base federal e
   `verificado: false`, e a tela avisa para conferir com a SES.
   Levantamento: 17/11/2026. */
(function () {
  "use strict";

  const LEVANTAMENTO = "2026-11-17";

  // Catálogo de itens. `origem`: 'sistema' (gerado no app) ou 'upload' (anexado com o
  // nome "[LME] <tag>"). Mudar uma `tag` desfaz o vínculo com anexos já feitos.
  const CATALOGO = {
    lme_laudo: { label: "LME — Laudo de Solicitação, Avaliação e Autorização de Medicamentos", origem: "sistema", tipoDoc: "laudo" },
    receita: { label: "Receita médica dos medicamentos solicitados", origem: "sistema", tipoDoc: "receita" },
    doc_identidade: { label: "Documento de identidade com foto (RG, CNH ou CIN)", origem: "upload", tag: "Documento de identidade" },
    cpf: { label: "CPF do paciente", origem: "upload", tag: "CPF" },
    cartao_sus: { label: "Cartão Nacional de Saúde (Cartão SUS)", origem: "upload", tag: "Cartão SUS" },
    comprovante_residencia: { label: "Comprovante de residência", origem: "upload", tag: "Comprovante de residência" },
    exames_diagnostico: { label: "Exames exigidos pelo PCDT da doença", origem: "upload", tag: "Exames do diagnóstico" },
    termo_consentimento: { label: "Termo de Esclarecimento e Responsabilidade (TER) assinado", origem: "upload", tag: "Termo de consentimento" },
    formulario_estadual: { label: "Formulário médico específico da doença (SES)", origem: "upload", tag: "Formulário médico estadual" },
    relatorio_complementar: { label: "Relatório médico", origem: "upload", tag: "Relatório médico complementar" },
    doc_responsavel: { label: "Documento e CPF do responsável legal", origem: "upload", tag: "Documento do responsável" },
    declaracao_residencia: { label: "Declaração de residência (comprovante em nome de terceiro ou anonimizado)", origem: "upload", tag: "Declaração de residência" },
    autorizacao_representante: { label: "Autorização e documentos do representante (retirada por outra pessoa)", origem: "upload", tag: "Autorização do representante" },
    laudo_anatomopatologico: { label: "Laudo anatomopatológico / biópsia", origem: "upload", tag: "Anatomopatológico" },
    declaracao_tratamentos: { label: "Declaração de tratamentos anteriores / falha terapêutica", origem: "upload", tag: "Tratamentos anteriores" },
    certidao_nascimento: { label: "Certidão de nascimento (se o paciente não tiver RG)", origem: "upload", tag: "Certidão de nascimento" },
  };

  const FONTE_FEDERAL = {
    titulo: "Ministério da Saúde — Componente Especializado (como acessar)",
    url: "https://www.gov.br/saude/pt-br/composicao/sectics/daf/ceaf",
  };

  // Base federal: LME, prescrição, documentos do PCDT, CNS, identidade e residência.
  const BASE = {
    itens: {
      lme_laudo: { exigido: true },
      receita: { exigido: true },
      doc_identidade: { exigido: true, detalhe: "Cópia" },
      cartao_sus: { exigido: true, detalhe: "Cópia" },
      comprovante_residencia: { exigido: true, detalhe: "Cópia" },
      exames_diagnostico: { exigido: true, detalhe: "Conforme o PCDT do medicamento" },
      termo_consentimento: { exigido: false, detalhe: "Quando o PCDT exigir" },
      cpf: { exigido: false },
      relatorio_complementar: { exigido: false },
      doc_responsavel: { exigido: false, detalhe: "Paciente incapaz ou menor de idade" },
      laudo_anatomopatologico: { exigido: false },
      declaracao_tratamentos: { exigido: false },
      certidao_nascimento: { exigido: false },
    },
    regras: [
      "Um LME por CID-10; até 6 medicamentos por LME.",
      "Cada LME autoriza até 6 meses de tratamento (2 APACs de 3 competências); a renovação exige novo LME e receita.",
      "Solicitação eletrônica com cópia simples: LME e receita em papel na primeira dispensação.",
    ],
  };

  const UFS = {
    SC: {
      nome: "Santa Catarina",
      verificado: true,
      lme_validade_dias: 90,
      canal: "Unidade de Assistência Farmacêutica do município (UDAF), processo no SISMEDEX.",
      itens: {
        lme_laudo: { detalhe: "Nome genérico, carimbo e assinatura do médico e assinatura do paciente ou responsável. Vale 90 dias após o preenchimento" },
        receita: { detalhe: "Original, com nome genérico" },
        termo_consentimento: { exigido: true, detalhe: "TER do PCDT, assinado pelo médico e pelo paciente ou responsável" },
        formulario_estadual: { exigido: true, label: "Formulário Médico DIAF/SC da doença", detalhe: "Vale 90 dias após o preenchimento" },
        exames_diagnostico: { detalhe: "Cópia, conforme o PCDT" },
        doc_identidade: { detalhe: "Cópia de RG, CNH, certidão de nascimento ou outro. O RG novo com número do CNS substitui o cartão SUS" },
        cartao_sus: { detalhe: "Cópia. Dispensado se o RG novo trouxer o número do CNS" },
        comprovante_residencia: { detalhe: "Atual (até 3 meses), em nome do paciente ou responsável, sem dados anonimizados" },
        cpf: { exigido: true, detalhe: "Obrigatório para tramitar na SES/SC" },
        declaracao_residencia: { exigido: false, detalhe: "Só junto do comprovante anonimizado, quando não houver 2ª via com dados (Lei 7.115/1983)" },
      },
      regras: ["LME e Formulário Médico DIAF/SC valem 90 dias entre o preenchimento e a entrega."],
      fontes: [
        { titulo: "Nota Técnica nº 39/2022 DIAF/SPS/SES/SC", url: "https://www.saude.sc.gov.br/edocman/legislacao/legislacao-geral/notas-tecnicas/nt%2039%20ceaf%20dez.pdf" },
        { titulo: "Nota Técnica nº 16/2024 DIAF/SAS/SES/SC (comprovante de residência)", url: "https://saude.sc.gov.br/index.php/pt/legislacao/legislacao-geral/notas-tecnicas/nota-tecnica-n-16-2024-diaf-sas-ses-sc/download" },
      ],
    },
    BA: {
      nome: "Bahia",
      verificado: true,
      canal: "Salvador: unidade de referência da doença (ex.: CIMEB). Interior: Núcleos e Bases Regionais de Saúde. Cadastro no AFSESAB.",
      itens: {
        lme_laudo: { detalhe: "Assinado e carimbado. Renovar a cada 6 meses" },
        receita: { detalhe: "Assinada e carimbada, conforme a legislação sanitária do medicamento" },
        cpf: { exigido: true, detalhe: "Cópia, junto da identidade" },
        comprovante_residencia: { detalhe: "Cópia, em nome do paciente ou do responsável legal" },
        declaracao_residencia: { exigido: false, detalhe: "Formulário próprio quando o comprovante está em nome de terceiro" },
        termo_consentimento: { exigido: true, detalhe: "Assinado pelo médico e pelo paciente" },
        relatorio_complementar: { exigido: true, label: "Relatório médico com CID-10", detalhe: "Evolução clínica (últimos 12 meses em algumas doenças), critérios de inclusão e ausência de exclusão do PCDT" },
        formulario_estadual: { exigido: false, label: "Formulário de acesso da doença (SESAB)", detalhe: "Algumas doenças, ex.: Doença de Crohn" },
        exames_diagnostico: { detalhe: "Lista e validade por doença no Fluxo de Acesso da SESAB (exames laboratoriais, em geral, 3 meses)" },
      },
      regras: ["Documentos (exames, LME e receita) renovados a cada 6 meses com o médico assistente."],
      fontes: [
        { titulo: "SESAB — Fluxo de Acesso Doença de Crohn (fev/2026)", url: "https://www.ba.gov.br/saude/sites/site-sesab/files/2026-07/Fluxo-de-Acesso-DOENCA-DE-CROHN-1.pdf" },
        { titulo: "SESAB — Fluxo de Acesso Doença Falciforme (ago/2026)", url: "https://www.ba.gov.br/saude/sites/site-sesab/files/2026-08/FLUXO-DE-ACESSO-DOENCA-FALCIFORME-1.pdf" },
      ],
    },
    MG: {
      nome: "Minas Gerais",
      verificado: true,
      canal: "Farmácia Digital MG (primeira solicitação), MG App/cidadao.mg.gov.br, ou farmácia municipal/Unidade Regional de Saúde.",
      itens: {
        cpf: { exigido: true },
        formulario_estadual: { exigido: true, label: "Formulário específico da doença (SES-MG)", detalhe: "Ou relatório médico, conforme a lista da doença" },
        relatorio_complementar: { exigido: false, detalhe: "Quando a lista da doença pedir" },
        lme_laudo: { detalhe: "Original na primeira retirada (assinatura digital dispensa o papel)" },
        receita: { detalhe: "Original na primeira retirada (assinatura digital dispensa o papel)" },
      },
      regras: [
        "Documentos médicos com assinatura digital dispensam a versão impressa.",
        "Agendamento obrigatório em Belo Horizonte, Juiz de Fora e Uberlândia.",
      ],
      fontes: [
        { titulo: "MG — Solicitar Medicamentos Especializados", url: "https://www.mg.gov.br/node/18879" },
        { titulo: "MG — Acessar Farmácia Digital", url: "https://www.mg.gov.br/servico/acessar-farmacia-digital" },
        { titulo: "SES-MG — Formulários CEAF por doença", url: "https://www.saude.mg.gov.br/obtermedicamentos/ceaf/formulariosceaf/" },
      ],
    },
    RS: {
      nome: "Rio Grande do Sul",
      verificado: true,
      canal: "Farmácia Digital RS (login gov.br, solicitação e renovação) ou Farmácia de Medicamentos Especiais (FME) do município.",
      itens: {
        lme_laudo: { detalhe: "Original entregue na FME na primeira retirada" },
        receita: { detalhe: "Original entregue na FME na primeira retirada" },
        exames_diagnostico: { detalhe: "Cópia; laudo, exames e receita devem comprovar o CID" },
      },
      regras: ["No pedido digital, os originais ficam com o paciente e são entregues na FME na retirada."],
      fontes: [
        { titulo: "SES-RS — Solicitar medicamentos", url: "https://saude.rs.gov.br/solicitar-medicamentos" },
        { titulo: "SES-RS — Farmácia Digital", url: "https://saude.rs.gov.br/farmacia-digital" },
      ],
    },
    SP: {
      nome: "São Paulo",
      verificado: true,
      parcial: true,
      canal: "Farmácia de Medicamentos Especializados de referência; a lista exata está na ficha de cada medicamento da SES-SP.",
      itens: {
        lme_laudo: { detalhe: "Original, completo e legível, sem rasura. Em parte das fichas vale 90 dias" },
        receita: { detalhe: "Original; algumas fichas pedem 2 vias" },
        cpf: { exigido: true, detalhe: "Junto da identidade" },
        comprovante_residencia: { detalhe: "Com CEP, em nome do paciente" },
        declaracao_residencia: { exigido: false, detalhe: "Comprovante em nome de terceiro: carta de residência ou prova de vínculo" },
        autorizacao_representante: { exigido: false, detalhe: "Declaração autorizadora + identidade e comprovante de endereço do representante" },
      },
      regras: ["As exigências variam por medicamento: confira a ficha da SES-SP do medicamento solicitado."],
      fontes: [
        { titulo: "SES-SP — Nota Técnica CAF nº 5/2020, Anexo 01 (regras do LME)", url: "https://portal.saude.sp.gov.br/resources/ses/perfil/gestor/assistencia-farmaceutica/notas-tecnicas/anexo_01_-_regras_para_elaboracao_correta_e_completa_do_lme.pdf" },
        { titulo: "SES-SP — Fichas por medicamento (ex.: Morfina, 2025)", url: "https://saude.sp.gov.br/resources/ses/perfil/gestor/assistencia-farmaceutica/medicamentos-do-componente-especializado-da-assistencia-farmaceutica/197_morfina_dor_v16_06-25.pdf" },
      ],
    },
    GO: {
      nome: "Goiás",
      verificado: true,
      parcial: true,
      canal: "Abertura digital na CEMAC Juarez Barbosa (login gov.br). Arquivos em PDF, JPG ou PNG.",
      itens: {
        receita: { detalhe: "Receita de controle especial: original" },
      },
      regras: [
        "Os originais ficam com o paciente e podem ser pedidos a qualquer momento.",
        "A lista de documentos e exames é por doença, no site da SES-GO.",
      ],
      fontes: [
        { titulo: "SES-GO — Instruções gerais para abertura de processo (abr/2024)", url: "https://goias.gov.br/saude/wp-content/uploads/sites/34/files/cemac/informacoes/orientacoes-gerais.pdf" },
        { titulo: "SES-GO — Documentos para solicitação de medicamentos", url: "https://goias.gov.br/saude/documentos-para-solicitacao-de-medicamentos/" },
      ],
    },
    PR: {
      nome: "Paraná",
      verificado: true,
      parcial: true,
      canal: "Farmácia do Paraná: farmácias das Regionais de Saúde ou municipais; digital (Farmácia do Paraná Digital) em municípios habilitados.",
      itens: {},
      regras: ["Documentos e exames por medicamento e CID na consulta da Farmácia do Paraná. Avaliação em até 60 dias."],
      fontes: [
        { titulo: "SESA-PR — Solicitar medicamentos à Farmácia do Paraná", url: "https://www.saude.pr.gov.br/servicos/Cidadania/Assistencia-social/Solicitar-medicamentos-a-Farmacia-do-Parana-pA3LwNbm" },
      ],
    },
  };

  // Segunda rodada (17/11/2026).
  Object.assign(UFS, {
    RJ: {
      nome: "Rio de Janeiro",
      verificado: true,
      canal: "Farmácias de Medicamentos Especializados (polos municipais e RioFarmes Praça XI, Duque de Caxias e Nova Iguaçu). Presencial.",
      itens: {
        lme_laudo: { detalhe: "Original impresso, carimbado e assinado. Só vale se o médico estiver vinculado a estabelecimento com CNES" },
        receita: { detalhe: "2 vias, até 90 dias (controle especial: 30 dias), em DCB, só com os medicamentos do campo 7 do LME" },
        cpf: { exigido: true, detalhe: "Original e cópia" },
        doc_identidade: { detalhe: "Original e cópia" },
        cartao_sus: { detalhe: "Original e cópia" },
        comprovante_residencia: { detalhe: "Emitido há menos de 90 dias. Original e cópia" },
        relatorio_complementar: { exigido: true, label: "Laudo médico detalhado (até 90 dias)", detalhe: "Pode ser substituído pela anamnese (campo 11) do LME com quadro, critérios do PCDT, gravidade e tratamentos anteriores" },
        termo_consentimento: { detalhe: "Quando o PCDT exigir. Assinado por responsável: identidade, CPF e comprovante dele" },
        declaracao_residencia: { exigido: false, detalhe: "Autodeclaração de residência aceita para o responsável" },
        autorizacao_representante: { exigido: false, detalhe: "Declaração autorizadora + RG, CPF e comprovante do representante e identidade do paciente" },
      },
      regras: ["Laudo, receita e LME da mesma instituição solicitante.", "Checklist por doença no site da SES-RJ."],
      fontes: [{ titulo: "SES-RJ — Como ter acesso aos medicamentos especializados", url: "https://www.rj.gov.br/saude/safie-como-ter-acesso-aos-medicamentos-especializados" }],
    },
    ES: {
      nome: "Espírito Santo",
      verificado: true,
      canal: "Farmácia Cidadã Estadual de referência do município (presencial) ou solicitação on-line no portal de serviços da SESA.",
      itens: {
        doc_identidade: { detalhe: "Cópia de identidade, CNH ou carteira de trabalho (criança: certidão de nascimento)" },
        cpf: { exigido: true, detalhe: "Cópia" },
        comprovante_residencia: { detalhe: "Atual, cópia" },
        receita: { detalhe: "2 vias: nome genérico, concentração, posologia, tempo de tratamento, quantidade mensal, carimbo, assinatura e data" },
        lme_laudo: { detalhe: "Todos os campos preenchidos pelo médico" },
        termo_consentimento: { exigido: true, detalhe: "Datado, carimbado e assinado pelo médico e pelo paciente (modelo por doença)" },
        exames_diagnostico: { detalhe: "Os do PCDT para abertura e continuidade (resumo da SESA por doença)" },
        autorizacao_representante: { exigido: false, detalhe: "Procuração (modelos para maior e menor de 18) + documento com a mesma assinatura e cópia da identidade" },
      },
      regras: ["Avaliação em 20 dias úteis (medicamentos padronizados). Renovação a cada 6 meses."],
      fontes: [
        { titulo: "Farmácia Cidadã — Documentação para abrir processo", url: "https://farmaciacidada.es.gov.br/documentacao-necessaria-para-abrir-processo-de-medicamento" },
        { titulo: "Farmácia Cidadã — Documentos de abertura e continuidade", url: "https://farmaciacidada.es.gov.br/documentos-abertura-e-continuidade" },
      ],
    },
    RN: {
      nome: "Rio Grande do Norte",
      verificado: true,
      canal: "Unidades UNICAT (Natal, Alecrim, Assú, Pau dos Ferros, Caicó, Currais Novos, Santa Cruz), com agendamento on-line.",
      itens: {
        cpf: { exigido: true, detalhe: "Cópia" },
        receita: { detalhe: "Em DCB; vale 60 dias (controlados: 30 dias)" },
        termo_consentimento: { exigido: true, detalhe: "Assinado pelo médico e pelo paciente ou responsável" },
        formulario_estadual: { exigido: false, label: "Declaração médica de controle especial", detalhe: "Medicamentos sujeitos a controle especial" },
        doc_responsavel: { detalhe: "Paciente incapaz: identidade, endereço e telefone do responsável indicado no LME" },
        autorizacao_representante: { exigido: false, detalhe: "Declaração autorizadora + cópia da identidade do paciente" },
      },
      regras: ["Três meses sem retirar o medicamento: exames, LME e receita atualizados."],
      fontes: [{ titulo: "UNICAT/SESAP-RN — Acesso aos medicamentos do CEAF", url: "https://www.unicat.rn.gov.br/postagem/acesso-aos-medicamentos-do-ceaf/" }],
    },
    SE: {
      nome: "Sergipe",
      verificado: true,
      lme_validade_dias: 90,
      canal: "CASE — Centro de Atenção à Saúde de Sergipe (Aracaju): recepção e perícia presencial ou documental.",
      itens: {
        lme_laudo: { detalhe: "Preenchido pelo médico assistente, com data de menos de 90 dias" },
        receita: { detalhe: "Legível, assinada e carimbada pelo mesmo médico" },
        doc_identidade: { detalhe: "Original e cópia" },
        cpf: { exigido: true, detalhe: "Original e cópia" },
        cartao_sus: { detalhe: "Original e cópia" },
        comprovante_residencia: { detalhe: "Original e cópia" },
        relatorio_complementar: { exigido: true, label: "Relatório médico detalhado com CID-10", detalhe: "Assinado e carimbado pelo mesmo médico" },
        termo_consentimento: { exigido: true, detalhe: "2 vias, assinado e carimbado pelo médico e assinado pelo paciente" },
        exames_diagnostico: { detalhe: "Cópia, realizados há menos de 3 meses" },
        autorizacao_representante: { exigido: false, detalhe: "Procuração (modelo do CASE) + documento original do paciente" },
      },
      regras: ["O médico assistente não pode ser o perito do processo.", "Documentação renovada no 3º mês, conforme o medicamento."],
      fontes: [{ titulo: "SES-SE — CASE (passo a passo)", url: "https://www.saude.se.gov.br/?p=27037" }],
    },
    MA: {
      nome: "Maranhão",
      verificado: true,
      canal: "FEME — Farmácia Estadual de Medicamentos Especializados, São Luís.",
      itens: {
        doc_identidade: { detalhe: "Cópia de RG ou certidão de nascimento" },
        cpf: { exigido: true, detalhe: "Cópia" },
        receita: { detalhe: "2 vias, legível, com princípio ativo e dosagem" },
        termo_consentimento: { exigido: true },
      },
      regras: [],
      fontes: [{ titulo: "SES-MA — Farmácia de Medicamentos Especializados (FEME)", url: "https://saude.ma.gov.br/paginas/unidade-farmacia-de-medicamentos-especializados-feme" }],
    },
    AM: {
      nome: "Amazonas",
      verificado: true,
      parcial: true,
      canal: "Farmácias do CEAF do Estado (CEMA, Manaus).",
      itens: {
        doc_identidade: { detalhe: "Identidade ou certidão de nascimento" },
        exames_diagnostico: { detalhe: "Todos os do PCDT e comprovação do CID-10" },
      },
      regras: ["A página da SES-AM não cita CPF nem comprovante de residência: a lista federal ainda os exige."],
      fontes: [{ titulo: "SES-AM — CEMA, Assistência Farmacêutica", url: "https://www.saude.am.gov.br/unidades-de-saude/cema/assistencia-farmaceutica/" }],
    },
    PB: {
      nome: "Paraíba",
      verificado: true,
      parcial: true,
      canal: "CEDMEX (João Pessoa). Guia de documentos por doença no site da SES-PB.",
      itens: {
        cpf: { exigido: true },
        comprovante_residencia: { detalhe: "Com CEP" },
        receita: { detalhe: "Com posologia para 1 mês de tratamento" },
        relatorio_complementar: { exigido: true, label: "Laudo médico com histórico clínico e diagnóstico" },
        autorizacao_representante: { exigido: false, detalhe: "Declaração autorizadora com RG e CPF de quem autoriza" },
      },
      regras: ["Lista final no guia informativo da doença (CEDMEX); vários guias pedem renovação a cada 6 meses."],
      fontes: [{ titulo: "SES-PB — Documentos por patologia (CEDMEX)", url: "https://paraiba.pb.gov.br/diretas/saude/cedmex/documentos-por-patologia-para-obter-medicamentos" }],
    },
    DF: {
      nome: "Distrito Federal",
      verificado: true,
      parcial: true,
      canal: "Agendamento pelo 160 (opção 3) e entrega na farmácia de alto custo da região, ou CEAF Digital (ceafdigital.saude.df.gov.br).",
      itens: {
        receita: { detalhe: "Pelo princípio ativo, não pelo nome comercial" },
        declaracao_residencia: { exigido: false, label: "Declaração de Residência CEAF (SES-DF)" },
        autorizacao_representante: { exigido: false, detalhe: "Declaração autorizadora (até 4 representantes para entrega)" },
      },
      regras: ["Conferência documental seguida de revisão médica obrigatória.", "Originais apresentados na retirada."],
      fontes: [
        { titulo: "SES-DF — Componente Especializado", url: "https://saude.df.gov.br/componente-especializado/" },
        { titulo: "SES-DF — Protocolos, TER, resumos e formulários", url: "https://saude.df.gov.br/protocolos-clinicos-ter-resumos-e-formularios" },
      ],
    },
    PE: {
      nome: "Pernambuco",
      verificado: true,
      parcial: true,
      canal: "Farmácia de Pernambuco (setor de atendimento); o portador pode fazer a solicitação sem o paciente.",
      itens: {},
      regras: ["Renovação a cada 6 meses: no 5º recebimento o médico preenche a parte de renovação.", "Lista por doença no Guia de orientação ao usuário da Farmácia de Pernambuco."],
      fontes: [{ titulo: "SES-PE — Carta de Serviços, Medicamentos", url: "https://cartadeservicos.saude.pe.gov.br/medicamentos/" }],
    },
    PI: {
      nome: "Piauí",
      verificado: true,
      parcial: true,
      canal: "Farmácia do Povo — Componentes Especializados, Rua David Caldas 398, Teresina (WhatsApp 86 99425-1501).",
      itens: {},
      regras: ["A SESAPI não publica a lista de documentos na página: lista federal até confirmar."],
      fontes: [{ titulo: "SESAPI — Assistência Farmacêutica", url: "https://portal.pi.gov.br/sesapi/assistencia-farmaceutica/" }],
    },
  });

  const NOMES = {
    AC: "Acre", AL: "Alagoas", AP: "Amapá", CE: "Ceará", MT: "Mato Grosso", MS: "Mato Grosso do Sul",
    PA: "Pará", RO: "Rondônia", RR: "Roraima", TO: "Tocantins",
  };

  /** Monta a lista de documentos para a UF (base federal + exigências da SES). */
  function montar(uf, opcoes) {
    const sigla = String(uf || "").trim().toUpperCase();
    const est = UFS[sigla] || null;
    const itens = Object.assign({}, BASE.itens);
    if (est) {
      for (const [id, o] of Object.entries(est.itens || {})) itens[id] = Object.assign({}, itens[id] || { exigido: false }, o);
    }
    // Paciente incapaz/menor: o documento do responsável passa a ser exigido.
    if (opcoes && opcoes.incapaz && itens.doc_responsavel) itens.doc_responsavel = Object.assign({}, itens.doc_responsavel, { exigido: true });
    const lista = Object.entries(itens)
      .filter(([id]) => CATALOGO[id])
      .map(([id, o]) => Object.assign({ id }, CATALOGO[id], { exigido: !!o.exigido, detalhe: o.detalhe || "" }, o.label ? { label: o.label } : {}));
    lista.sort((a, b) => Number(b.exigido) - Number(a.exigido));
    return {
      uf: sigla,
      nome: est ? est.nome : NOMES[sigla] || "",
      verificado: !!(est && est.verificado),
      parcial: !!(est && est.parcial),
      canal: est ? est.canal : "",
      lmeValidadeDias: est && est.lme_validade_dias ? est.lme_validade_dias : null,
      regras: [...BASE.regras, ...((est && est.regras) || [])],
      fontes: [...((est && est.fontes) || []), FONTE_FEDERAL],
      levantamento: LEVANTAMENTO,
      itens: lista,
    };
  }

  window.LmeDocsUf = { montar, CATALOGO, UFS, LEVANTAMENTO };
})();
