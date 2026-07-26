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
      anamnese_models: {
        Row: {
          created_at: string
          id: string
          name: string
          prompt: string
          readonly: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          prompt: string
          readonly?: boolean
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          prompt?: string
          readonly?: boolean
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
          certificate_valid_from: string | null
          certificate_valid_until: string | null
          code_verifier_encrypted: string | null
          created_at: string
          credential_expires_at: string | null
          credential_id: string
          doctor_id: string
          id: string
          product_name: string | null
          provider_name: string | null
          raw_metadata: Json | null
          updated_at: string
        }
        Insert: {
          certificate_fingerprint?: string | null
          certificate_serial?: string | null
          certificate_subject?: string | null
          certificate_valid_from?: string | null
          certificate_valid_until?: string | null
          code_verifier_encrypted?: string | null
          created_at?: string
          credential_expires_at?: string | null
          credential_id: string
          doctor_id: string
          id?: string
          product_name?: string | null
          provider_name?: string | null
          raw_metadata?: Json | null
          updated_at?: string
        }
        Update: {
          certificate_fingerprint?: string | null
          certificate_serial?: string | null
          certificate_subject?: string | null
          certificate_valid_from?: string | null
          certificate_valid_until?: string | null
          code_verifier_encrypted?: string | null
          created_at?: string
          credential_expires_at?: string | null
          credential_id?: string
          doctor_id?: string
          id?: string
          product_name?: string | null
          provider_name?: string | null
          raw_metadata?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      exames: {
        Row: {
          created_at: string
          data: string | null
          file_name: string | null
          id: string
          nome: string
          obs: string | null
          paciente_id: string
          tipo: string | null
          updated_at: string
          user_id: string
          validade: string | null
          validade_dias: number | null
        }
        Insert: {
          created_at?: string
          data?: string | null
          file_name?: string | null
          id?: string
          nome: string
          obs?: string | null
          paciente_id: string
          tipo?: string | null
          updated_at?: string
          user_id?: string
          validade?: string | null
          validade_dias?: number | null
        }
        Update: {
          created_at?: string
          data?: string | null
          file_name?: string | null
          id?: string
          nome?: string
          obs?: string | null
          paciente_id?: string
          tipo?: string | null
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
        ]
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
          sexo?: string | null
          sus?: string | null
          telefone?: string | null
          uf?: string | null
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
          nome_dcb: string
          nome_exibicao: string
        }
        Insert: {
          api_id?: number | null
          created_at?: string
          grupo_busca?: string | null
          id_substancia?: string
          nome_dcb: string
          nome_exibicao: string
        }
        Update: {
          api_id?: number | null
          created_at?: string
          grupo_busca?: string | null
          id_substancia?: string
          nome_dcb?: string
          nome_exibicao?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      buscar_comerciais: {
        Args: { termo: string }
        Returns: {
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
      grupo_busca_substancia: { Args: { nome_dcb: string }; Returns: string }
      listar_apresentacoes_comercial: {
        Args: { p_fabricante: string; p_nome_comercial: string }
        Returns: {
          apresentacao: string
          registro_anvisa: string
        }[]
      }
      listar_apresentacoes_generico: {
        Args: { p_fabricante?: string; p_id_substancia: string }
        Returns: {
          apresentacao: string
          fabricante: string
          registro_anvisa: string
        }[]
      }
      listar_fabricantes_generico: {
        Args: { p_id_substancia: string }
        Returns: {
          fabricante: string
          qtd_apresentacoes: number
        }[]
      }
      normaliza_substancia: { Args: { t: string }; Returns: string }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
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
