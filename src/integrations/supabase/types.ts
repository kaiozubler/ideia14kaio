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
      substancias: {
        Row: {
          created_at: string
          grupo_busca: string | null
          id_substancia: string
          nome_dcb: string
          nome_exibicao: string
        }
        Insert: {
          created_at?: string
          grupo_busca?: string | null
          id_substancia?: string
          nome_dcb: string
          nome_exibicao: string
        }
        Update: {
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
