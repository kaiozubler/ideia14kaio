export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agendamentos: {
        Row: {
          cpf: string | null
          created_at: string
          data_hora: string
          duracao_min: number
          especialidade: string | null
          id: string
          id_medico: string
          medico_nome: string | null
          motivo: string | null
          observacoes: string | null
          origem: string | null
          paciente_id: string | null
          paciente_nome: string | null
          status: string
          telefone: string | null
          tipo: string | null
          updated_at: string
        }
        Insert: {
          cpf?: string | null
          created_at?: string
          data_hora: string
          duracao_min?: number
          especialidade?: string | null
          id?: string
          id_medico: string
          medico_nome?: string | null
          motivo?: string | null
          observacoes?: string | null
          origem?: string | null
          paciente_id?: string | null
          paciente_nome?: string | null
          status?: string
          telefone?: string | null
          tipo?: string | null
          updated_at?: string
        }
        Update: {
          cpf?: string | null
          created_at?: string
          data_hora?: string
          duracao_min?: number
          especialidade?: string | null
          id?: string
          id_medico?: string
          medico_nome?: string | null
          motivo?: string | null
          observacoes?: string | null
          origem?: string | null
          paciente_id?: string | null
          paciente_nome?: string | null
          status?: string
          telefone?: string | null
          tipo?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agendamentos_paciente_id_fkey"
            columns: ["paciente_id"]
            isOneToOne: false
            referencedRelation: "pacientes"
            referencedColumns: ["paciente_id"]
          },
        ]
      }
      anamnese_models: {
        Row: {
          created_at: string
          id: string
          is_default: boolean
          name: string
          prompt: string
          readonly: boolean
          sources: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          prompt: string
          readonly?: boolean
          sources?: Json
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          prompt?: string
          readonly?: boolean
          sources?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      assinaturas_digitais: {
        Row: {
          arquivo_assinado: string | null
          bry_envelope_id: string | null
          consulta_id: string | null
          created_at: string
          documento_id: string | null
          download_url: string | null
          erro: string | null
          id: string
          paciente_email: string | null
          paciente_nome: string | null
          sign_url: string | null
          status: string
          tipo_documento: string
          updated_at: string
          user_id: string
        }
        Insert: {
          arquivo_assinado?: string | null
          bry_envelope_id?: string | null
          consulta_id?: string | null
          created_at?: string
          documento_id?: string | null
          download_url?: string | null
          erro?: string | null
          id?: string
          paciente_email?: string | null
          paciente_nome?: string | null
          sign_url?: string | null
          status?: string
          tipo_documento: string
          updated_at?: string
          user_id: string
        }
        Update: {
          arquivo_assinado?: string | null
          bry_envelope_id?: string | null
          consulta_id?: string | null
          created_at?: string
          documento_id?: string | null
          download_url?: string | null
          erro?: string | null
          id?: string
          paciente_email?: string | null
          paciente_nome?: string | null
          sign_url?: string | null
          status?: string
          tipo_documento?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assinaturas_digitais_consulta_id_fkey"
            columns: ["consulta_id"]
            isOneToOne: false
            referencedRelation: "consulta"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assinaturas_digitais_documento_id_fkey"
            columns: ["documento_id"]
            isOneToOne: false
            referencedRelation: "documentos_paciente"
            referencedColumns: ["id"]
          },
        ]
      }
      base_conhecimento: {
        Row: {
          ativo: boolean | null
          created_at: string | null
          descricao: string
          ias: string[] | null
          id: string
          medico_id: string | null
          nome: string
          tags: string[] | null
        }
        Insert: {
          ativo?: boolean | null
          created_at?: string | null
          descricao: string
          ias?: string[] | null
          id?: string
          medico_id?: string | null
          nome: string
          tags?: string[] | null
        }
        Update: {
          ativo?: boolean | null
          created_at?: string | null
          descricao?: string
          ias?: string[] | null
          id?: string
          medico_id?: string | null
          nome?: string
          tags?: string[] | null
        }
        Relationships: []
      }
      base_conhecimento_itens: {
        Row: {
          base_id: string | null
          conteudo: string
          created_at: string | null
          id: string
          nome_original: string | null
          ordem: number | null
          tipo: string | null
          tokens_estimados: number | null
        }
        Insert: {
          base_id?: string | null
          conteudo: string
          created_at?: string | null
          id?: string
          nome_original?: string | null
          ordem?: number | null
          tipo?: string | null
          tokens_estimados?: number | null
        }
        Update: {
          base_id?: string | null
          conteudo?: string
          created_at?: string | null
          id?: string
          nome_original?: string | null
          ordem?: number | null
          tipo?: string | null
          tokens_estimados?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "base_conhecimento_itens_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "base_conhecimento"
            referencedColumns: ["id"]
          },
        ]
      }
      cid10: {
        Row: {
          codigo: string
          created_at: string
          descricao: string
          id: string
        }
        Insert: {
          codigo: string
          created_at?: string
          descricao: string
          id?: string
        }
        Update: {
          codigo?: string
          created_at?: string
          descricao?: string
          id?: string
        }
        Relationships: []
      }
      conceitos_clinicos: {
        Row: {
          ativo: boolean
          codigo: string
          created_at: string
          descricao: string | null
          id: string
          rotulo: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ativo?: boolean
          codigo: string
          created_at?: string
          descricao?: string | null
          id?: string
          rotulo: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          ativo?: boolean
          codigo?: string
          created_at?: string
          descricao?: string | null
          id?: string
          rotulo?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      consulta: {
        Row: {
          acao: string | null
          anamnese_ia: string | null
          created_at: string
          ended_at: string | null
          id: string
          id_medico: string
          nota_personal: string | null
          notas: string | null
          paciente_id: string
          resumo: string | null
          started_at: string
          title: string | null
          updated_at: string
        }
        Insert: {
          acao?: string | null
          anamnese_ia?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
          id_medico?: string
          nota_personal?: string | null
          notas?: string | null
          paciente_id: string
          resumo?: string | null
          started_at?: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          acao?: string | null
          anamnese_ia?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
          id_medico?: string
          nota_personal?: string | null
          notas?: string | null
          paciente_id?: string
          resumo?: string | null
          started_at?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "consulta_paciente_id_fkey"
            columns: ["paciente_id"]
            isOneToOne: false
            referencedRelation: "pacientes"
            referencedColumns: ["paciente_id"]
          },
        ]
      }
      doctor_certificates: {
        Row: {
          certificate_fingerprint: string | null
          certificate_serial: string | null
          certificate_subject: string | null
          certificate_type: string
          certificate_valid_from: string | null
          certificate_valid_until: string | null
          code_verifier_encrypted: string | null
          created_at: string
          credential_expires_at: string | null
          credential_id: string
          doctor_id: string
          holder_document: string | null
          id: string
          issuer: string | null
          label: string | null
          product_name: string | null
          provider: string
          provider_name: string | null
          raw_metadata: Json | null
          storage_path: string | null
          updated_at: string
        }
        Insert: {
          certificate_fingerprint?: string | null
          certificate_serial?: string | null
          certificate_subject?: string | null
          certificate_type?: string
          certificate_valid_from?: string | null
          certificate_valid_until?: string | null
          code_verifier_encrypted?: string | null
          created_at?: string
          credential_expires_at?: string | null
          credential_id: string
          doctor_id: string
          holder_document?: string | null
          id?: string
          issuer?: string | null
          label?: string | null
          product_name?: string | null
          provider?: string
          provider_name?: string | null
          raw_metadata?: Json | null
          storage_path?: string | null
          updated_at?: string
        }
        Update: {
          certificate_fingerprint?: string | null
          certificate_serial?: string | null
          certificate_subject?: string | null
          certificate_type?: string
          certificate_valid_from?: string | null
          certificate_valid_until?: string | null
          code_verifier_encrypted?: string | null
          created_at?: string
          credential_expires_at?: string | null
          credential_id?: string
          doctor_id?: string
          holder_document?: string | null
          id?: string
          issuer?: string | null
          label?: string | null
          product_name?: string | null
          provider?: string
          provider_name?: string | null
          raw_metadata?: Json | null
          storage_path?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      documentos_paciente: {
        Row: {
          arquivo_nome: string | null
          arquivo_path: string | null
          canal_envio: string | null
          conteudo: Json
          created_at: string
          enviado_em: string | null
          id: string
          id_medico: string
          paciente_cpf: string | null
          paciente_id: string | null
          paciente_nome: string | null
          status: string
          texto: string | null
          tipo: string
          updated_at: string
        }
        Insert: {
          arquivo_nome?: string | null
          arquivo_path?: string | null
          canal_envio?: string | null
          conteudo?: Json
          created_at?: string
          enviado_em?: string | null
          id?: string
          id_medico: string
          paciente_cpf?: string | null
          paciente_id?: string | null
          paciente_nome?: string | null
          status?: string
          texto?: string | null
          tipo: string
          updated_at?: string
        }
        Update: {
          arquivo_nome?: string | null
          arquivo_path?: string | null
          canal_envio?: string | null
          conteudo?: Json
          created_at?: string
          enviado_em?: string | null
          id?: string
          id_medico?: string
          paciente_cpf?: string | null
          paciente_id?: string | null
          paciente_nome?: string | null
          status?: string
          texto?: string | null
          tipo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "documentos_paciente_paciente_id_fkey"
            columns: ["paciente_id"]
            isOneToOne: false
            referencedRelation: "pacientes"
            referencedColumns: ["paciente_id"]
          },
        ]
      }
      exame_alias: {
        Row: {
          ativo: boolean
          confianca: number | null
          created_at: string
          id: string
          origem: string
          texto_original: string
          tuss_procedimento_id: string
          user_id: string
        }
        Insert: {
          ativo?: boolean
          confianca?: number | null
          created_at?: string
          id?: string
          origem?: string
          texto_original: string
          tuss_procedimento_id: string
          user_id?: string
        }
        Update: {
          ativo?: boolean
          confianca?: number | null
          created_at?: string
          id?: string
          origem?: string
          texto_original?: string
          tuss_procedimento_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exame_alias_tuss_procedimento_id_fkey"
            columns: ["tuss_procedimento_id"]
            isOneToOne: false
            referencedRelation: "tuss_procedimentos"
            referencedColumns: ["id"]
          },
        ]
      }
      exame_modelos: {
        Row: {
          carater: string
          created_at: string
          id: string
          indicacao_clinica: string | null
          itens: Json
          jejum_necessario: boolean
          nome: string
          preparo: string | null
          updated_at: string
          user_id: string
          validade_dias: number | null
        }
        Insert: {
          carater?: string
          created_at?: string
          id?: string
          indicacao_clinica?: string | null
          itens?: Json
          jejum_necessario?: boolean
          nome: string
          preparo?: string | null
          updated_at?: string
          user_id?: string
          validade_dias?: number | null
        }
        Update: {
          carater?: string
          created_at?: string
          id?: string
          indicacao_clinica?: string | null
          itens?: Json
          jejum_necessario?: boolean
          nome?: string
          preparo?: string | null
          updated_at?: string
          user_id?: string
          validade_dias?: number | null
        }
        Relationships: []
      }
      exames: {
        Row: {
          arquivo_path: string | null
          created_at: string
          data: string | null
          file_name: string | null
          id: string
          nome: string
          obs: string | null
          paciente_id: string
          protocolo_tarefa_id: string | null
          resultado: string | null
          resultado_estruturado: Json | null
          resultado_original: string | null
          status_protocolo: string
          status_tuss: string
          tipo: string | null
          tuss_procedimento_id: string | null
          updated_at: string
          user_id: string
          validade: string | null
          validade_dias: number | null
        }
        Insert: {
          arquivo_path?: string | null
          created_at?: string
          data?: string | null
          file_name?: string | null
          id?: string
          nome: string
          obs?: string | null
          paciente_id: string
          protocolo_tarefa_id?: string | null
          resultado?: string | null
          resultado_estruturado?: Json | null
          resultado_original?: string | null
          status_protocolo?: string
          status_tuss?: string
          tipo?: string | null
          tuss_procedimento_id?: string | null
          updated_at?: string
          user_id?: string
          validade?: string | null
          validade_dias?: number | null
        }
        Update: {
          arquivo_path?: string | null
          created_at?: string
          data?: string | null
          file_name?: string | null
          id?: string
          nome?: string
          obs?: string | null
          paciente_id?: string
          protocolo_tarefa_id?: string | null
          resultado?: string | null
          resultado_estruturado?: Json | null
          resultado_original?: string | null
          status_protocolo?: string
          status_tuss?: string
          tipo?: string | null
          tuss_procedimento_id?: string | null
          updated_at?: string
          user_id?: string
          validade?: string | null
          validade_dias?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "exames_paciente_id_fkey"
            columns: ["paciente_id"]
            isOneToOne: false
            referencedRelation: "pacientes"
            referencedColumns: ["paciente_id"]
          },
          {
            foreignKeyName: "exames_protocolo_tarefa_id_fkey"
            columns: ["protocolo_tarefa_id"]
            isOneToOne: false
            referencedRelation: "protocolo_tarefas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exames_tuss_procedimento_id_fkey"
            columns: ["tuss_procedimento_id"]
            isOneToOne: false
            referencedRelation: "tuss_procedimentos"
            referencedColumns: ["id"]
          },
        ]
      }
      ia_assist_conversas: {
        Row: {
          created_at: string
          favorito: boolean
          id: string
          id_medico: string
          mensagens: Json
          titulo: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          favorito?: boolean
          id?: string
          id_medico: string
          mensagens?: Json
          titulo?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          favorito?: boolean
          id?: string
          id_medico?: string
          mensagens?: Json
          titulo?: string
          updated_at?: string
        }
        Relationships: []
      }
      interacoes: {
        Row: {
          acao: string | null
          api_interacao_id: number | null
          created_at: string
          id: string
          mecanismo_efeito: string | null
          medicamento_1_id: string
          medicamento_2_id: string
          recomendacoes: string | null
          ultima_sincronizacao: string
          updated_at: string
        }
        Insert: {
          acao?: string | null
          api_interacao_id?: number | null
          created_at?: string
          id?: string
          mecanismo_efeito?: string | null
          medicamento_1_id: string
          medicamento_2_id: string
          recomendacoes?: string | null
          ultima_sincronizacao?: string
          updated_at?: string
        }
        Update: {
          acao?: string | null
          api_interacao_id?: number | null
          created_at?: string
          id?: string
          mecanismo_efeito?: string | null
          medicamento_1_id?: string
          medicamento_2_id?: string
          recomendacoes?: string | null
          ultima_sincronizacao?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "interacoes_medicamento_1_id_fkey"
            columns: ["medicamento_1_id"]
            isOneToOne: false
            referencedRelation: "medicamentos_crfmg"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interacoes_medicamento_2_id_fkey"
            columns: ["medicamento_2_id"]
            isOneToOne: false
            referencedRelation: "medicamentos_crfmg"
            referencedColumns: ["id"]
          },
        ]
      }
      interacoes_medicamentosas: {
        Row: {
          created_at: string
          descricao: string | null
          fonte: string | null
          gravidade: string | null
          id_interacao: string
          id_substancia_a: string
          id_substancia_b: string
        }
        Insert: {
          created_at?: string
          descricao?: string | null
          fonte?: string | null
          gravidade?: string | null
          id_interacao?: string
          id_substancia_a: string
          id_substancia_b: string
        }
        Update: {
          created_at?: string
          descricao?: string | null
          fonte?: string | null
          gravidade?: string | null
          id_interacao?: string
          id_substancia_a?: string
          id_substancia_b?: string
        }
        Relationships: [
          {
            foreignKeyName: "interacoes_medicamentosas_id_substancia_a_fkey"
            columns: ["id_substancia_a"]
            isOneToOne: false
            referencedRelation: "substancias"
            referencedColumns: ["id_substancia"]
          },
          {
            foreignKeyName: "interacoes_medicamentosas_id_substancia_b_fkey"
            columns: ["id_substancia_b"]
            isOneToOne: false
            referencedRelation: "substancias"
            referencedColumns: ["id_substancia"]
          },
        ]
      }
      interacoes_sync_log: {
        Row: {
          created_at: string
          data_fim: string | null
          data_inicio: string
          id: string
          mensagem_erro: string | null
          quantidade_atualizadas: number
          quantidade_erros: number
          quantidade_novas: number
          quantidade_processada: number
          status: string
          ultimo_medicamento_processado: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          data_fim?: string | null
          data_inicio?: string
          id?: string
          mensagem_erro?: string | null
          quantidade_atualizadas?: number
          quantidade_erros?: number
          quantidade_novas?: number
          quantidade_processada?: number
          status?: string
          ultimo_medicamento_processado?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          data_fim?: string | null
          data_inicio?: string
          id?: string
          mensagem_erro?: string | null
          quantidade_atualizadas?: number
          quantidade_erros?: number
          quantidade_novas?: number
          quantidade_processada?: number
          status?: string
          ultimo_medicamento_processado?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      lancamentos_financeiros: {
        Row: {
          comissao_pct: number
          comissao_val: number
          created_at: string
          data: string
          descricao: string
          especialidade: string | null
          etiqueta: string | null
          id: string
          medico: string | null
          natureza: string | null
          nf_emitida_em: string | null
          nf_numero: number | null
          nf_payload: Json | null
          nf_serie: string | null
          nf_status: string | null
          paciente_id: string | null
          paciente_nome: string | null
          pago: boolean
          status: string
          tipo: string
          updated_at: string
          user_id: string
          valor: number
          vencimento: string | null
        }
        Insert: {
          comissao_pct?: number
          comissao_val?: number
          created_at?: string
          data?: string
          descricao?: string
          especialidade?: string | null
          etiqueta?: string | null
          id?: string
          medico?: string | null
          natureza?: string | null
          nf_emitida_em?: string | null
          nf_numero?: number | null
          nf_payload?: Json | null
          nf_serie?: string | null
          nf_status?: string | null
          paciente_id?: string | null
          paciente_nome?: string | null
          pago?: boolean
          status?: string
          tipo?: string
          updated_at?: string
          user_id?: string
          valor?: number
          vencimento?: string | null
        }
        Update: {
          comissao_pct?: number
          comissao_val?: number
          created_at?: string
          data?: string
          descricao?: string
          especialidade?: string | null
          etiqueta?: string | null
          id?: string
          medico?: string | null
          natureza?: string | null
          nf_emitida_em?: string | null
          nf_numero?: number | null
          nf_payload?: Json | null
          nf_serie?: string | null
          nf_status?: string | null
          paciente_id?: string | null
          paciente_nome?: string | null
          pago?: boolean
          status?: string
          tipo?: string
          updated_at?: string
          user_id?: string
          valor?: number
          vencimento?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lancamentos_financeiros_paciente_id_fkey"
            columns: ["paciente_id"]
            isOneToOne: false
            referencedRelation: "pacientes"
            referencedColumns: ["paciente_id"]
          },
        ]
      }
      medicamento_substancias: {
        Row: {
          concentracao: string | null
          id_medicamento: string
          id_substancia: string
        }
        Insert: {
          concentracao?: string | null
          id_medicamento: string
          id_substancia: string
        }
        Update: {
          concentracao?: string | null
          id_medicamento?: string
          id_substancia?: string
        }
        Relationships: [
          {
            foreignKeyName: "medicamento_substancias_id_medicamento_fkey"
            columns: ["id_medicamento"]
            isOneToOne: false
            referencedRelation: "medicamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medicamento_substancias_id_substancia_fkey"
            columns: ["id_substancia"]
            isOneToOne: false
            referencedRelation: "substancias"
            referencedColumns: ["id_substancia"]
          },
        ]
      }
      medicamentos: {
        Row: {
          api_id: number | null
          apresentacao: string | null
          categoria_regulatoria: string | null
          classe_terapeutica: string | null
          cnpj_fabricante: string | null
          codigo_ggrem: string | null
          comercializado_2025: boolean | null
          created_at: string
          fabricante: string | null
          id: string
          is_generico: boolean
          nome_comercial: string | null
          regime_preco: string | null
          registro_anvisa: string | null
          tarja: string | null
        }
        Insert: {
          api_id?: number | null
          apresentacao?: string | null
          categoria_regulatoria?: string | null
          classe_terapeutica?: string | null
          cnpj_fabricante?: string | null
          codigo_ggrem?: string | null
          comercializado_2025?: boolean | null
          created_at?: string
          fabricante?: string | null
          id: string
          is_generico?: boolean
          nome_comercial?: string | null
          regime_preco?: string | null
          registro_anvisa?: string | null
          tarja?: string | null
        }
        Update: {
          api_id?: number | null
          apresentacao?: string | null
          categoria_regulatoria?: string | null
          classe_terapeutica?: string | null
          cnpj_fabricante?: string | null
          codigo_ggrem?: string | null
          comercializado_2025?: boolean | null
          created_at?: string
          fabricante?: string | null
          id?: string
          is_generico?: boolean
          nome_comercial?: string | null
          regime_preco?: string | null
          registro_anvisa?: string | null
          tarja?: string | null
        }
        Relationships: []
      }
      medicamentos_crfmg: {
        Row: {
          api_id: number
          created_at: string
          id: string
          id_substancia: string | null
          indicacoes: string | null
          nome: string
          nome_normalizado: string | null
          ultima_sincronizacao: string | null
          updated_at: string
        }
        Insert: {
          api_id: number
          created_at?: string
          id?: string
          id_substancia?: string | null
          indicacoes?: string | null
          nome: string
          nome_normalizado?: string | null
          ultima_sincronizacao?: string | null
          updated_at?: string
        }
        Update: {
          api_id?: number
          created_at?: string
          id?: string
          id_substancia?: string | null
          indicacoes?: string | null
          nome?: string
          nome_normalizado?: string | null
          ultima_sincronizacao?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "medicamentos_crfmg_id_substancia_fkey"
            columns: ["id_substancia"]
            isOneToOne: false
            referencedRelation: "substancias"
            referencedColumns: ["id_substancia"]
          },
        ]
      }
      medico_whatsapp_config: {
        Row: {
          agendamento_ativo: boolean
          created_at: string
          id_medico: string
          mensagem_convite: string | null
          numero_exibicao: string | null
          phone_number_id: string | null
          updated_at: string
        }
        Insert: {
          agendamento_ativo?: boolean
          created_at?: string
          id_medico: string
          mensagem_convite?: string | null
          numero_exibicao?: string | null
          phone_number_id?: string | null
          updated_at?: string
        }
        Update: {
          agendamento_ativo?: boolean
          created_at?: string
          id_medico?: string
          mensagem_convite?: string | null
          numero_exibicao?: string | null
          phone_number_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      mensagens_consulta: {
        Row: {
          content: string
          created_at: string
          id: string
          id_consulta: string
          role: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          id_consulta: string
          role: string
          user_id?: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          id_consulta?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mensagens_consulta_id_consulta_fkey"
            columns: ["id_consulta"]
            isOneToOne: false
            referencedRelation: "consulta"
            referencedColumns: ["id"]
          },
        ]
      }
      paciente_protocolos: {
        Row: {
          ativo: boolean
          cid_code: string | null
          created_at: string
          id: string
          iniciado_em: string
          paciente_id: string
          protocolo_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ativo?: boolean
          cid_code?: string | null
          created_at?: string
          id?: string
          iniciado_em?: string
          paciente_id: string
          protocolo_id: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          ativo?: boolean
          cid_code?: string | null
          created_at?: string
          id?: string
          iniciado_em?: string
          paciente_id?: string
          protocolo_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "paciente_protocolos_paciente_id_fkey"
            columns: ["paciente_id"]
            isOneToOne: false
            referencedRelation: "pacientes"
            referencedColumns: ["paciente_id"]
          },
          {
            foreignKeyName: "paciente_protocolos_protocolo_id_fkey"
            columns: ["protocolo_id"]
            isOneToOne: false
            referencedRelation: "protocolos"
            referencedColumns: ["id"]
          },
        ]
      }
      pacientes: {
        Row: {
          bairro: string | null
          cep: string | null
          cidade: string | null
          cids: Json
          complemento: string | null
          convenio: string | null
          cpf: string | null
          created_at: string
          dados_clinicos: string | null
          data_nascimento: string | null
          email: string | null
          endereco: string | null
          grupo: string | null
          info_complementar: Json
          logradouro: string | null
          mae: string | null
          medico: string | null
          name: string
          numero: string | null
          ocupacao: string | null
          paciente_id: string
          pai: string | null
          parentescos: Json
          sexo: string | null
          sus: string | null
          telefone: string | null
          uf: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          cids?: Json
          complemento?: string | null
          convenio?: string | null
          cpf?: string | null
          created_at?: string
          dados_clinicos?: string | null
          data_nascimento?: string | null
          email?: string | null
          endereco?: string | null
          grupo?: string | null
          info_complementar?: Json
          logradouro?: string | null
          mae?: string | null
          medico?: string | null
          name: string
          numero?: string | null
          ocupacao?: string | null
          paciente_id?: string
          pai?: string | null
          parentescos?: Json
          sexo?: string | null
          sus?: string | null
          telefone?: string | null
          uf?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          cids?: Json
          complemento?: string | null
          convenio?: string | null
          cpf?: string | null
          created_at?: string
          dados_clinicos?: string | null
          data_nascimento?: string | null
          email?: string | null
          endereco?: string | null
          grupo?: string | null
          info_complementar?: Json
          logradouro?: string | null
          mae?: string | null
          medico?: string | null
          name?: string
          numero?: string | null
          ocupacao?: string | null
          paciente_id?: string
          pai?: string | null
          parentescos?: Json
          sexo?: string | null
          sus?: string | null
          telefone?: string | null
          uf?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      prompt_comandos: {
        Row: {
          atalho: string
          created_at: string | null
          ias: string[] | null
          id: string
          medico_id: string | null
          texto_completo: string
        }
        Insert: {
          atalho: string
          created_at?: string | null
          ias?: string[] | null
          id?: string
          medico_id?: string | null
          texto_completo: string
        }
        Update: {
          atalho?: string
          created_at?: string | null
          ias?: string[] | null
          id?: string
          medico_id?: string | null
          texto_completo?: string
        }
        Relationships: []
      }
      protocolo_acoes: {
        Row: {
          auto_restart: boolean
          catalogo_status: string
          created_at: string
          descricao: string | null
          especialidade: string | null
          frequency: number
          id: string
          id_substancia: string | null
          nome: string
          protocolo_id: string
          recurrent: boolean
          regra_pai_id: string | null
          start_day: number
          tipo: string
          tuss_procedimento_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_restart?: boolean
          catalogo_status?: string
          created_at?: string
          descricao?: string | null
          especialidade?: string | null
          frequency?: number
          id?: string
          id_substancia?: string | null
          nome: string
          protocolo_id: string
          recurrent?: boolean
          regra_pai_id?: string | null
          start_day?: number
          tipo?: string
          tuss_procedimento_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          auto_restart?: boolean
          catalogo_status?: string
          created_at?: string
          descricao?: string | null
          especialidade?: string | null
          frequency?: number
          id?: string
          id_substancia?: string | null
          nome?: string
          protocolo_id?: string
          recurrent?: boolean
          regra_pai_id?: string | null
          start_day?: number
          tipo?: string
          tuss_procedimento_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "protocolo_acoes_id_substancia_fkey"
            columns: ["id_substancia"]
            isOneToOne: false
            referencedRelation: "substancias"
            referencedColumns: ["id_substancia"]
          },
          {
            foreignKeyName: "protocolo_acoes_protocolo_id_fkey"
            columns: ["protocolo_id"]
            isOneToOne: false
            referencedRelation: "protocolos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protocolo_acoes_regra_pai_fkey"
            columns: ["regra_pai_id"]
            isOneToOne: false
            referencedRelation: "protocolo_regras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protocolo_acoes_tuss_procedimento_id_fkey"
            columns: ["tuss_procedimento_id"]
            isOneToOne: false
            referencedRelation: "tuss_procedimentos"
            referencedColumns: ["id"]
          },
        ]
      }
      protocolo_cids: {
        Row: {
          cid_code: string
          created_at: string
          id: string
          protocolo_id: string
          user_id: string
        }
        Insert: {
          cid_code: string
          created_at?: string
          id?: string
          protocolo_id: string
          user_id?: string
        }
        Update: {
          cid_code?: string
          created_at?: string
          id?: string
          protocolo_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "protocolo_cids_protocolo_id_fkey"
            columns: ["protocolo_id"]
            isOneToOne: false
            referencedRelation: "protocolos"
            referencedColumns: ["id"]
          },
        ]
      }
      protocolo_regras: {
        Row: {
          acao_gatilho_id: string
          condicao: Json | null
          created_at: string
          descricao: string | null
          id: string
          is_default: boolean
          ordem: number
          protocolo_id: string
          repete_gatilho_apos_dias: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          acao_gatilho_id: string
          condicao?: Json | null
          created_at?: string
          descricao?: string | null
          id?: string
          is_default?: boolean
          ordem?: number
          protocolo_id: string
          repete_gatilho_apos_dias?: number | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          acao_gatilho_id?: string
          condicao?: Json | null
          created_at?: string
          descricao?: string | null
          id?: string
          is_default?: boolean
          ordem?: number
          protocolo_id?: string
          repete_gatilho_apos_dias?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "protocolo_regras_acao_gatilho_id_fkey"
            columns: ["acao_gatilho_id"]
            isOneToOne: false
            referencedRelation: "protocolo_acoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protocolo_regras_protocolo_id_fkey"
            columns: ["protocolo_id"]
            isOneToOne: false
            referencedRelation: "protocolos"
            referencedColumns: ["id"]
          },
        ]
      }
      protocolo_tarefas: {
        Row: {
          acao_id: string
          created_at: string
          due_date: string
          id: string
          notice_desc: string | null
          notice_type: string | null
          notified_at: string | null
          ocorrencia: number
          paciente_id: string
          paciente_protocolo_id: string
          protocolo_id: string
          regra_origem_id: string | null
          resultado_registrado_em: string | null
          resultado_valor: Json | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          acao_id: string
          created_at?: string
          due_date: string
          id?: string
          notice_desc?: string | null
          notice_type?: string | null
          notified_at?: string | null
          ocorrencia?: number
          paciente_id: string
          paciente_protocolo_id: string
          protocolo_id: string
          regra_origem_id?: string | null
          resultado_registrado_em?: string | null
          resultado_valor?: Json | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          acao_id?: string
          created_at?: string
          due_date?: string
          id?: string
          notice_desc?: string | null
          notice_type?: string | null
          notified_at?: string | null
          ocorrencia?: number
          paciente_id?: string
          paciente_protocolo_id?: string
          protocolo_id?: string
          regra_origem_id?: string | null
          resultado_registrado_em?: string | null
          resultado_valor?: Json | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "protocolo_tarefas_acao_id_fkey"
            columns: ["acao_id"]
            isOneToOne: false
            referencedRelation: "protocolo_acoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protocolo_tarefas_paciente_id_fkey"
            columns: ["paciente_id"]
            isOneToOne: false
            referencedRelation: "pacientes"
            referencedColumns: ["paciente_id"]
          },
          {
            foreignKeyName: "protocolo_tarefas_paciente_protocolo_id_fkey"
            columns: ["paciente_protocolo_id"]
            isOneToOne: false
            referencedRelation: "paciente_protocolos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protocolo_tarefas_protocolo_id_fkey"
            columns: ["protocolo_id"]
            isOneToOne: false
            referencedRelation: "protocolos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protocolo_tarefas_regra_origem_id_fkey"
            columns: ["regra_origem_id"]
            isOneToOne: false
            referencedRelation: "protocolo_regras"
            referencedColumns: ["id"]
          },
        ]
      }
      protocolos: {
        Row: {
          ativo: boolean
          created_at: string
          id: string
          titulo: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          id?: string
          titulo: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          id?: string
          titulo?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      questionario_email_codigos: {
        Row: {
          codigo: string
          created_at: string
          email: string
          expira_em: string
          id: string
          questionario_id: string
          tentativas: number
          verificado: boolean
        }
        Insert: {
          codigo: string
          created_at?: string
          email: string
          expira_em: string
          id?: string
          questionario_id: string
          tentativas?: number
          verificado?: boolean
        }
        Update: {
          codigo?: string
          created_at?: string
          email?: string
          expira_em?: string
          id?: string
          questionario_id?: string
          tentativas?: number
          verificado?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "questionario_email_codigos_questionario_id_fkey"
            columns: ["questionario_id"]
            isOneToOne: false
            referencedRelation: "questionarios"
            referencedColumns: ["id"]
          },
        ]
      }
      questionario_envios: {
        Row: {
          enviado_em: string
          id: string
          paciente_id: string | null
          questionario_id: string
          user_id: string
        }
        Insert: {
          enviado_em?: string
          id?: string
          paciente_id?: string | null
          questionario_id: string
          user_id?: string
        }
        Update: {
          enviado_em?: string
          id?: string
          paciente_id?: string | null
          questionario_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "questionario_envios_paciente_id_fkey"
            columns: ["paciente_id"]
            isOneToOne: false
            referencedRelation: "pacientes"
            referencedColumns: ["paciente_id"]
          },
          {
            foreignKeyName: "questionario_envios_questionario_id_fkey"
            columns: ["questionario_id"]
            isOneToOne: false
            referencedRelation: "questionarios"
            referencedColumns: ["id"]
          },
        ]
      }
      questionario_perguntas: {
        Row: {
          enunciado: string
          escala_label_max: string | null
          escala_label_min: string | null
          escala_max: number | null
          escala_min: number | null
          id: string
          longa: boolean
          obrigatoria: boolean
          opcoes: Json | null
          ordem: number
          questionario_id: string
          tipo: string
          user_id: string
        }
        Insert: {
          enunciado: string
          escala_label_max?: string | null
          escala_label_min?: string | null
          escala_max?: number | null
          escala_min?: number | null
          id?: string
          longa?: boolean
          obrigatoria?: boolean
          opcoes?: Json | null
          ordem?: number
          questionario_id: string
          tipo: string
          user_id?: string
        }
        Update: {
          enunciado?: string
          escala_label_max?: string | null
          escala_label_min?: string | null
          escala_max?: number | null
          escala_min?: number | null
          id?: string
          longa?: boolean
          obrigatoria?: boolean
          opcoes?: Json | null
          ordem?: number
          questionario_id?: string
          tipo?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "questionario_perguntas_questionario_id_fkey"
            columns: ["questionario_id"]
            isOneToOne: false
            referencedRelation: "questionarios"
            referencedColumns: ["id"]
          },
        ]
      }
      questionario_resposta_itens: {
        Row: {
          id: string
          pergunta_id: string
          resposta_id: string
          valor_escala: number | null
          valor_opcoes: Json | null
          valor_texto: string | null
        }
        Insert: {
          id?: string
          pergunta_id: string
          resposta_id: string
          valor_escala?: number | null
          valor_opcoes?: Json | null
          valor_texto?: string | null
        }
        Update: {
          id?: string
          pergunta_id?: string
          resposta_id?: string
          valor_escala?: number | null
          valor_opcoes?: Json | null
          valor_texto?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "questionario_resposta_itens_pergunta_id_fkey"
            columns: ["pergunta_id"]
            isOneToOne: false
            referencedRelation: "questionario_perguntas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questionario_resposta_itens_resposta_id_fkey"
            columns: ["resposta_id"]
            isOneToOne: false
            referencedRelation: "questionario_respostas"
            referencedColumns: ["id"]
          },
        ]
      }
      questionario_respostas: {
        Row: {
          id: string
          paciente_cpf: string | null
          paciente_email: string | null
          paciente_id: string | null
          paciente_nome: string | null
          paciente_telefone: string | null
          questionario_id: string
          respondido_em: string
        }
        Insert: {
          id?: string
          paciente_cpf?: string | null
          paciente_email?: string | null
          paciente_id?: string | null
          paciente_nome?: string | null
          paciente_telefone?: string | null
          questionario_id: string
          respondido_em?: string
        }
        Update: {
          id?: string
          paciente_cpf?: string | null
          paciente_email?: string | null
          paciente_id?: string | null
          paciente_nome?: string | null
          paciente_telefone?: string | null
          questionario_id?: string
          respondido_em?: string
        }
        Relationships: [
          {
            foreignKeyName: "questionario_respostas_paciente_id_fkey"
            columns: ["paciente_id"]
            isOneToOne: false
            referencedRelation: "pacientes"
            referencedColumns: ["paciente_id"]
          },
          {
            foreignKeyName: "questionario_respostas_questionario_id_fkey"
            columns: ["questionario_id"]
            isOneToOne: false
            referencedRelation: "questionarios"
            referencedColumns: ["id"]
          },
        ]
      }
      questionarios: {
        Row: {
          anonimo: boolean
          ativo: boolean
          campos_cadastro: Json
          created_at: string
          descricao: string | null
          exigir_auth_email: boolean
          id: string
          titulo: string
          user_id: string
        }
        Insert: {
          anonimo?: boolean
          ativo?: boolean
          campos_cadastro?: Json
          created_at?: string
          descricao?: string | null
          exigir_auth_email?: boolean
          id?: string
          titulo: string
          user_id?: string
        }
        Update: {
          anonimo?: boolean
          ativo?: boolean
          campos_cadastro?: Json
          created_at?: string
          descricao?: string | null
          exigir_auth_email?: boolean
          id?: string
          titulo?: string
          user_id?: string
        }
        Relationships: []
      }
      receita_modelos: {
        Row: {
          created_at: string
          formulas: Json
          id: string
          medicamentos: Json
          nome: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          formulas?: Json
          id?: string
          medicamentos?: Json
          nome: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          formulas?: Json
          id?: string
          medicamentos?: Json
          nome?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      resumo_prontuario: {
        Row: {
          created_at: string
          id: string
          id_medico: string
          paciente_id: string
          paciente_updated_at: string | null
          resumo: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          id_medico?: string
          paciente_id: string
          paciente_updated_at?: string | null
          resumo: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          id_medico?: string
          paciente_id?: string
          paciente_updated_at?: string | null
          resumo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "resumo_prontuario_paciente_id_fkey"
            columns: ["paciente_id"]
            isOneToOne: false
            referencedRelation: "pacientes"
            referencedColumns: ["paciente_id"]
          },
        ]
      }
      signature_pkce_sessions: {
        Row: {
          code_verifier_encrypted: string
          created_at: string
          doctor_id: string
          expires_at: string
          id: string
          request_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          code_verifier_encrypted: string
          created_at?: string
          doctor_id: string
          expires_at?: string
          id?: string
          request_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          code_verifier_encrypted?: string
          created_at?: string
          doctor_id?: string
          expires_at?: string
          id?: string
          request_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      substancias: {
        Row: {
          api_id: number | null
          created_at: string
          grupo_busca: string | null
          id_substancia: string
          lista_portaria344: string | null
          nome_dcb: string
          nome_exibicao: string
          tipo_receita: string | null
        }
        Insert: {
          api_id?: number | null
          created_at?: string
          grupo_busca?: string | null
          id_substancia?: string
          lista_portaria344?: string | null
          nome_dcb: string
          nome_exibicao: string
          tipo_receita?: string | null
        }
        Update: {
          api_id?: number | null
          created_at?: string
          grupo_busca?: string | null
          id_substancia?: string
          lista_portaria344?: string | null
          nome_dcb?: string
          nome_exibicao?: string
          tipo_receita?: string | null
        }
        Relationships: []
      }
      termo_assinaturas: {
        Row: {
          assinado_em: string
          checkbox_aceito: boolean
          email_verificado: boolean
          id: string
          paciente_cpf: string
          paciente_email: string
          paciente_id: string | null
          paciente_nome: string
          termo_id: string
          texto_final: string
        }
        Insert: {
          assinado_em?: string
          checkbox_aceito?: boolean
          email_verificado?: boolean
          id?: string
          paciente_cpf: string
          paciente_email: string
          paciente_id?: string | null
          paciente_nome: string
          termo_id: string
          texto_final: string
        }
        Update: {
          assinado_em?: string
          checkbox_aceito?: boolean
          email_verificado?: boolean
          id?: string
          paciente_cpf?: string
          paciente_email?: string
          paciente_id?: string | null
          paciente_nome?: string
          termo_id?: string
          texto_final?: string
        }
        Relationships: [
          {
            foreignKeyName: "termo_assinaturas_paciente_id_fkey"
            columns: ["paciente_id"]
            isOneToOne: false
            referencedRelation: "pacientes"
            referencedColumns: ["paciente_id"]
          },
          {
            foreignKeyName: "termo_assinaturas_termo_id_fkey"
            columns: ["termo_id"]
            isOneToOne: false
            referencedRelation: "termos"
            referencedColumns: ["id"]
          },
        ]
      }
      termo_email_codigos: {
        Row: {
          codigo: string
          created_at: string
          email: string
          expira_em: string
          id: string
          tentativas: number
          termo_id: string
          verificado: boolean
        }
        Insert: {
          codigo: string
          created_at?: string
          email: string
          expira_em: string
          id?: string
          tentativas?: number
          termo_id: string
          verificado?: boolean
        }
        Update: {
          codigo?: string
          created_at?: string
          email?: string
          expira_em?: string
          id?: string
          tentativas?: number
          termo_id?: string
          verificado?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "termo_email_codigos_termo_id_fkey"
            columns: ["termo_id"]
            isOneToOne: false
            referencedRelation: "termos"
            referencedColumns: ["id"]
          },
        ]
      }
      termos: {
        Row: {
          ativo: boolean
          checkbox_label: string
          corpo: string
          created_at: string
          id: string
          titulo: string
          user_id: string
        }
        Insert: {
          ativo?: boolean
          checkbox_label?: string
          corpo: string
          created_at?: string
          id?: string
          titulo: string
          user_id?: string
        }
        Update: {
          ativo?: boolean
          checkbox_label?: string
          corpo?: string
          created_at?: string
          id?: string
          titulo?: string
          user_id?: string
        }
        Relationships: []
      }
      timeline_events: {
        Row: {
          created_at: string
          event_date: string
          icon: string
          id: string
          paciente_id: string
          ref_id: string | null
          ref_type: string | null
          sub: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_date: string
          icon: string
          id?: string
          paciente_id: string
          ref_id?: string | null
          ref_type?: string | null
          sub?: string | null
          title: string
          type: string
          user_id?: string
        }
        Update: {
          created_at?: string
          event_date?: string
          icon?: string
          id?: string
          paciente_id?: string
          ref_id?: string | null
          ref_type?: string | null
          sub?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timeline_events_paciente_id_fkey"
            columns: ["paciente_id"]
            isOneToOne: false
            referencedRelation: "pacientes"
            referencedColumns: ["paciente_id"]
          },
        ]
      }
      tuss_procedimentos: {
        Row: {
          classe: string | null
          codigo_tuss: string
          created_at: string
          dados_originais: Json
          descricao: string | null
          fim_implantacao: string | null
          fim_vigencia: string | null
          grupo: string | null
          id: string
          inicio_vigencia: string | null
          nome: string
          status: string | null
          subgrupo: string | null
          tabela: string
          ultima_sincronizacao: string | null
          updated_at: string
        }
        Insert: {
          classe?: string | null
          codigo_tuss: string
          created_at?: string
          dados_originais?: Json
          descricao?: string | null
          fim_implantacao?: string | null
          fim_vigencia?: string | null
          grupo?: string | null
          id?: string
          inicio_vigencia?: string | null
          nome: string
          status?: string | null
          subgrupo?: string | null
          tabela?: string
          ultima_sincronizacao?: string | null
          updated_at?: string
        }
        Update: {
          classe?: string | null
          codigo_tuss?: string
          created_at?: string
          dados_originais?: Json
          descricao?: string | null
          fim_implantacao?: string | null
          fim_vigencia?: string | null
          grupo?: string | null
          id?: string
          inicio_vigencia?: string | null
          nome?: string
          status?: string | null
          subgrupo?: string | null
          tabela?: string
          ultima_sincronizacao?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      tuss_sync_log: {
        Row: {
          created_at: string
          data_fim: string | null
          data_inicio: string
          id: string
          mensagem_erro: string | null
          paginas_processadas: number
          paginas_total: number
          quantidade_atualizadas: number
          quantidade_erros: number
          quantidade_novas: number
          quantidade_processada: number
          status: string
          tabela: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          data_fim?: string | null
          data_inicio?: string
          id?: string
          mensagem_erro?: string | null
          paginas_processadas?: number
          paginas_total?: number
          quantidade_atualizadas?: number
          quantidade_erros?: number
          quantidade_novas?: number
          quantidade_processada?: number
          status?: string
          tabela?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          data_fim?: string | null
          data_inicio?: string
          id?: string
          mensagem_erro?: string | null
          paginas_processadas?: number
          paginas_total?: number
          quantidade_atualizadas?: number
          quantidade_erros?: number
          quantidade_novas?: number
          quantidade_processada?: number
          status?: string
          tabela?: string
          updated_at?: string
        }
        Relationships: []
      }
      whatsapp_conversas: {
        Row: {
          created_at: string
          id: string
          id_medico: string
          mensagens: Json
          paciente_id: string | null
          telefone: string
          ultima_interacao: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          id_medico: string
          mensagens?: Json
          paciente_id?: string | null
          telefone: string
          ultima_interacao?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          id_medico?: string
          mensagens?: Json
          paciente_id?: string | null
          telefone?: string
          ultima_interacao?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_conversas_paciente_id_fkey"
            columns: ["paciente_id"]
            isOneToOne: false
            referencedRelation: "pacientes"
            referencedColumns: ["paciente_id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      avaliar_condicao: {
        Args: { p_condicao: Json; p_resultado: Json }
        Returns: boolean
      }
      avaliar_resultado_exame: {
        Args: {
          p_exame_id: string
          p_paciente_id: string
          p_resultado: Json
          p_tuss_procedimento_id: string
        }
        Returns: {
          protocolo_id: string
          protocolo_titulo: string
          regra_id: string
          status_protocolo: string
          tarefa_id: string
        }[]
      }
      avaliar_resultado_tarefa: {
        Args: { p_resultado: Json; p_tarefa_id: string }
        Returns: {
          regra_id: string
          status: string
          tarefas_criadas: number
        }[]
      }
      buscar_cid10: {
        Args: { p_limit?: number; termo: string }
        Returns: {
          codigo: string
          descricao: string
        }[]
      }
      buscar_comerciais: {
        Args: { termo: string }
        Returns: {
          composicao: string
          fabricante: string
          nome_comercial: string
          qtd_apresentacoes: number
        }[]
      }
      buscar_genericos: {
        Args: { termo: string }
        Returns: {
          grupo_busca: string
          id_substancia: string
          nome_exibicao: string
          qtd_fabricantes: number
        }[]
      }
      buscar_pacientes: {
        Args: { p_limit?: number; termo: string }
        Returns: {
          cpf: string
          data_nascimento: string
          name: string
          paciente_id: string
          sobrenome: string
        }[]
      }
      buscar_parentes_possiveis: {
        Args: { p_limit?: number; p_paciente_id: string }
        Returns: {
          cpf: string
          data_nascimento: string
          motivo: string
          name: string
          paciente_id: string
          parentesco_sugerido: string
        }[]
      }
      buscar_tuss:
        | {
            Args: { p_limit?: number; p_tabela?: string; termo: string }
            Returns: {
              classe: string
              codigo_tuss: string
              descricao: string
              grupo: string
              id: string
              nome: string
              subgrupo: string
            }[]
          }
        | {
            Args: {
              p_limit?: number
              p_tabela?: string
              p_usar_alias?: boolean
              p_user_id?: string
              termo: string
            }
            Returns: {
              classe: string
              codigo_tuss: string
              descricao: string
              grupo: string
              id: string
              nome: string
              subgrupo: string
            }[]
          }
      consolidar_interacoes_crfmg: { Args: never; Returns: number }
      formulario_publico: { Args: { p_id: string }; Returns: Json }
      gerar_tarefas_protocolo: {
        Args: { p_vinculo_id: string }
        Returns: undefined
      }
      grafo_familiar: { Args: { p_paciente_id?: string }; Returns: Json }
      grau_do_parentesco: { Args: { termo: string }; Returns: string }
      grupo_busca_substancia: { Args: { nome_dcb: string }; Returns: string }
      historico_familiar_cids: {
        Args: { p_paciente_id: string }
        Returns: {
          cid_code: string
          cid_descricao: string
          grau: string
          parente_id: string
          parente_nome: string
          parentesco: string
        }[]
      }
      listar_apresentacoes_comercial: {
        Args: { p_fabricante?: string; p_nome_comercial: string }
        Returns: {
          apresentacao: string
        }[]
      }
      listar_apresentacoes_generico: {
        Args: { p_fabricante?: string; p_id_substancia: string }
        Returns: {
          apresentacao: string
        }[]
      }
      listar_fabricantes_generico: {
        Args: { p_id_substancia: string }
        Returns: {
          fabricante: string
        }[]
      }
      normaliza_substancia: { Args: { t: string }; Returns: string }
      parentesco_papel: { Args: { termo: string }; Returns: string }
      parentesco_papel_composto: {
        Args: { papel1: string; papel2: string }
        Returns: string
      }
      parentesco_papel_oposto: { Args: { papel: string }; Returns: string }
      parentesco_reciproco: { Args: { termo: string }; Returns: string }
      parentesco_termo_por_papel: { Args: { papel: string }; Returns: string }
      relatorio_protocolos: {
        Args: never
        Returns: {
          action: string
          action_type: string
          age: number
          cid: string
          doctor: string
          due: string
          id: string
          late: boolean
          notice_desc: string
          notice_type: string
          paciente_id: string
          patient: string
          protocol: string
          protocolo_id: string
          specialty: string
          status: string
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      sincronizar_protocolo: {
        Args: { p_protocolo_id: string }
        Returns: undefined
      }
      sincronizar_protocolos_paciente: {
        Args: { p_paciente_id: string }
        Returns: undefined
      }
      sobrenome_paciente: { Args: { nome: string }; Returns: string }
      termo_publico: { Args: { p_id: string }; Returns: Json }
      unaccent: { Args: { "": string }; Returns: string }
      verificar_interacoes: {
        Args: { p_termos: string[] }
        Returns: {
          acao: string
          farmaco_1: string
          farmaco_2: string
          id: string
          mecanismo_efeito: string
          recomendacoes: string
        }[]
      }
      verificar_interacoes_selecionados: {
        Args: { p_medicamento_ids: string[] }
        Returns: {
          descricao: string
          fonte: string
          gravidade: string
          id_interacao: string
          medicamento_a: string
          medicamento_b: string
          substancia_a: string
          substancia_b: string
        }[]
      }
      vincular_crfmg_substancias: { Args: never; Returns: number }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
