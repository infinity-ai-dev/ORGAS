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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      clientes_pj: {
        Row: {
          anexo_simples: Database["public"]["Enums"]["anexo_simples"] | null
          ativo: boolean | null
          cnae_principal: string | null
          cnpj: string
          created_at: string | null
          created_by: string | null
          email: string | null
          endereco: Json | null
          grupo_economico_id: string | null
          id: string
          nome_fantasia: string | null
          razao_social: string
          regime_tributario:
            | Database["public"]["Enums"]["regime_tributario"]
            | null
          telefone: string | null
          tipo_estabelecimento:
            | Database["public"]["Enums"]["tipo_estabelecimento"]
            | null
          updated_at: string | null
        }
        Insert: {
          anexo_simples?: Database["public"]["Enums"]["anexo_simples"] | null
          ativo?: boolean | null
          cnae_principal?: string | null
          cnpj: string
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          endereco?: Json | null
          grupo_economico_id?: string | null
          id?: string
          nome_fantasia?: string | null
          razao_social: string
          regime_tributario?:
            | Database["public"]["Enums"]["regime_tributario"]
            | null
          telefone?: string | null
          tipo_estabelecimento?:
            | Database["public"]["Enums"]["tipo_estabelecimento"]
            | null
          updated_at?: string | null
        }
        Update: {
          anexo_simples?: Database["public"]["Enums"]["anexo_simples"] | null
          ativo?: boolean | null
          cnae_principal?: string | null
          cnpj?: string
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          endereco?: Json | null
          grupo_economico_id?: string | null
          id?: string
          nome_fantasia?: string | null
          razao_social?: string
          regime_tributario?:
            | Database["public"]["Enums"]["regime_tributario"]
            | null
          telefone?: string | null
          tipo_estabelecimento?:
            | Database["public"]["Enums"]["tipo_estabelecimento"]
            | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clientes_pj_grupo_economico_id_fkey"
            columns: ["grupo_economico_id"]
            isOneToOne: false
            referencedRelation: "clientes_pj"
            referencedColumns: ["id"]
          },
        ]
      }
      dados_extraidos: {
        Row: {
          anexo_detectado: string | null
          cliente_id: string
          competencia: string | null
          compras_mes: Json | null
          confianca: number | null
          created_at: string | null
          dados_extrato: Json | null
          dados_folha: Json | null
          dados_guia: Json | null
          dados_nfe: Json | null
          dados_nfse: Json | null
          dados_pgdas: Json | null
          documento_id: string
          estabelecimentos: Json | null
          extraido_em: string | null
          fator_r_aplicado: number | null
          historico_folhas: Json | null
          historico_impostos: Json | null
          historico_receitas: Json | null
          id: string
          impostos_retidos: Json | null
          modelo_ia: string | null
          pix_recebidos: Json | null
          tipo_documento: Database["public"]["Enums"]["tipo_documento"]
          tokens_usados: number | null
          transferencias: Json | null
          updated_at: string | null
          valor_total: number | null
          vendas_cartao: Json | null
        }
        Insert: {
          anexo_detectado?: string | null
          cliente_id: string
          competencia?: string | null
          compras_mes?: Json | null
          confianca?: number | null
          created_at?: string | null
          dados_extrato?: Json | null
          dados_folha?: Json | null
          dados_guia?: Json | null
          dados_nfe?: Json | null
          dados_nfse?: Json | null
          dados_pgdas?: Json | null
          documento_id: string
          estabelecimentos?: Json | null
          extraido_em?: string | null
          fator_r_aplicado?: number | null
          historico_folhas?: Json | null
          historico_impostos?: Json | null
          historico_receitas?: Json | null
          id?: string
          impostos_retidos?: Json | null
          modelo_ia?: string | null
          pix_recebidos?: Json | null
          tipo_documento: Database["public"]["Enums"]["tipo_documento"]
          tokens_usados?: number | null
          transferencias?: Json | null
          updated_at?: string | null
          valor_total?: number | null
          vendas_cartao?: Json | null
        }
        Update: {
          anexo_detectado?: string | null
          cliente_id?: string
          competencia?: string | null
          compras_mes?: Json | null
          confianca?: number | null
          created_at?: string | null
          dados_extrato?: Json | null
          dados_folha?: Json | null
          dados_guia?: Json | null
          dados_nfe?: Json | null
          dados_nfse?: Json | null
          dados_pgdas?: Json | null
          documento_id?: string
          estabelecimentos?: Json | null
          extraido_em?: string | null
          fator_r_aplicado?: number | null
          historico_folhas?: Json | null
          historico_impostos?: Json | null
          historico_receitas?: Json | null
          id?: string
          impostos_retidos?: Json | null
          modelo_ia?: string | null
          pix_recebidos?: Json | null
          tipo_documento?: Database["public"]["Enums"]["tipo_documento"]
          tokens_usados?: number | null
          transferencias?: Json | null
          updated_at?: string | null
          valor_total?: number | null
          vendas_cartao?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "dados_extraidos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes_pj"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dados_extraidos_documento_id_fkey"
            columns: ["documento_id"]
            isOneToOne: true
            referencedRelation: "documentos"
            referencedColumns: ["id"]
          },
        ]
      }
      documentos: {
        Row: {
          ano: number | null
          classificacao_metadata: Json | null
          cliente_id: string
          created_at: string | null
          created_by: string | null
          erro_mensagem: string | null
          gemini_file_name: string | null
          gemini_file_uri: string | null
          id: string
          mes: number | null
          nome_arquivo: string
          nome_original: string
          periodo: string | null
          status: Database["public"]["Enums"]["documento_status"] | null
          storage_path: string
          tamanho_bytes: number
          tipo_documento: Database["public"]["Enums"]["tipo_documento"] | null
          tipo_mime: string
          updated_at: string | null
        }
        Insert: {
          ano?: number | null
          classificacao_metadata?: Json | null
          cliente_id: string
          created_at?: string | null
          created_by?: string | null
          erro_mensagem?: string | null
          gemini_file_name?: string | null
          gemini_file_uri?: string | null
          id?: string
          mes?: number | null
          nome_arquivo: string
          nome_original: string
          periodo?: string | null
          status?: Database["public"]["Enums"]["documento_status"] | null
          storage_path: string
          tamanho_bytes: number
          tipo_documento?: Database["public"]["Enums"]["tipo_documento"] | null
          tipo_mime: string
          updated_at?: string | null
        }
        Update: {
          ano?: number | null
          classificacao_metadata?: Json | null
          cliente_id?: string
          created_at?: string | null
          created_by?: string | null
          erro_mensagem?: string | null
          gemini_file_name?: string | null
          gemini_file_uri?: string | null
          id?: string
          mes?: number | null
          nome_arquivo?: string
          nome_original?: string
          periodo?: string | null
          status?: Database["public"]["Enums"]["documento_status"] | null
          storage_path?: string
          tamanho_bytes?: number
          tipo_documento?: Database["public"]["Enums"]["tipo_documento"] | null
          tipo_mime?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documentos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes_pj"
            referencedColumns: ["id"]
          },
        ]
      }
      historico_revisoes: {
        Row: {
          acao: string
          comentario: string | null
          created_at: string | null
          id: string
          relatorio_id: string
          status_anterior: string | null
          status_novo: string
          usuario_id: string
        }
        Insert: {
          acao: string
          comentario?: string | null
          created_at?: string | null
          id?: string
          relatorio_id: string
          status_anterior?: string | null
          status_novo: string
          usuario_id: string
        }
        Update: {
          acao?: string
          comentario?: string | null
          created_at?: string | null
          id?: string
          relatorio_id?: string
          status_anterior?: string | null
          status_novo?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "historico_revisoes_relatorio_id_fkey"
            columns: ["relatorio_id"]
            isOneToOne: false
            referencedRelation: "relatorios_fiscais"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          full_name: string
          id: string
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          full_name: string
          id: string
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          full_name?: string
          id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      relatorios_fiscais: {
        Row: {
          alertas: Json | null
          anexo_efetivo: string | null
          ano: number
          aprovado_em: string | null
          aprovado_por: string | null
          cliente_id: string
          competencia: string
          created_at: string | null
          documentos_processados: number | null
          economia_vs_presumido: number | null
          fator_r: number | null
          folha_encargos: number | null
          folha_total_bruto: number | null
          gerado_em: string | null
          guias_estaduais: number | null
          guias_federais: number | null
          guias_municipais: number | null
          id: string
          mes: number
          modelo_ia: string | null
          observacoes: string | null
          presumido_base_irpj: number | null
          presumido_cofins: number | null
          presumido_csll: number | null
          presumido_irpj: number | null
          presumido_iss: number | null
          presumido_pis: number | null
          presumido_total: number | null
          rbt12_calculado: number | null
          receita_bruta_12_meses: number | null
          receita_bruta_mes: number | null
          regime_tributario_selecionado: string | null
          secao1_faturamento: Json | null
          secao2_financeiro: Json | null
          secao3_documentos: Json | null
          secao4_tabela_mensal: Json | null
          secao5_acompanham: Json | null
          secao6_analisados: Json | null
          secao7_tributaria: Json | null
          secao8_assinatura: Json | null
          simples_aliquota_efetiva: number | null
          simples_anexo: string | null
          simples_cofins: number | null
          simples_cpp: number | null
          simples_csll: number | null
          simples_deducao: number | null
          simples_icms: number | null
          simples_irpj: number | null
          simples_iss: number | null
          simples_pis: number | null
          simples_valor_devido: number | null
          status: string | null
          tipo_parecer: string | null
          tipo_relatorio: string | null
          total_compras: number | null
          total_impostos_retidos: number | null
          total_notas_emitidas: number | null
          total_notas_recebidas: number | null
          updated_at: string | null
          valor_notas_emitidas: number | null
          valor_notas_recebidas: number | null
        }
        Insert: {
          alertas?: Json | null
          anexo_efetivo?: string | null
          ano: number
          aprovado_em?: string | null
          aprovado_por?: string | null
          cliente_id: string
          competencia: string
          created_at?: string | null
          documentos_processados?: number | null
          economia_vs_presumido?: number | null
          fator_r?: number | null
          folha_encargos?: number | null
          folha_total_bruto?: number | null
          gerado_em?: string | null
          guias_estaduais?: number | null
          guias_federais?: number | null
          guias_municipais?: number | null
          id?: string
          mes: number
          modelo_ia?: string | null
          observacoes?: string | null
          presumido_base_irpj?: number | null
          presumido_cofins?: number | null
          presumido_csll?: number | null
          presumido_irpj?: number | null
          presumido_iss?: number | null
          presumido_pis?: number | null
          presumido_total?: number | null
          rbt12_calculado?: number | null
          receita_bruta_12_meses?: number | null
          receita_bruta_mes?: number | null
          regime_tributario_selecionado?: string | null
          secao1_faturamento?: Json | null
          secao2_financeiro?: Json | null
          secao3_documentos?: Json | null
          secao4_tabela_mensal?: Json | null
          secao5_acompanham?: Json | null
          secao6_analisados?: Json | null
          secao7_tributaria?: Json | null
          secao8_assinatura?: Json | null
          simples_aliquota_efetiva?: number | null
          simples_anexo?: string | null
          simples_cofins?: number | null
          simples_cpp?: number | null
          simples_csll?: number | null
          simples_deducao?: number | null
          simples_icms?: number | null
          simples_irpj?: number | null
          simples_iss?: number | null
          simples_pis?: number | null
          simples_valor_devido?: number | null
          status?: string | null
          tipo_parecer?: string | null
          tipo_relatorio?: string | null
          total_compras?: number | null
          total_impostos_retidos?: number | null
          total_notas_emitidas?: number | null
          total_notas_recebidas?: number | null
          updated_at?: string | null
          valor_notas_emitidas?: number | null
          valor_notas_recebidas?: number | null
        }
        Update: {
          alertas?: Json | null
          anexo_efetivo?: string | null
          ano?: number
          aprovado_em?: string | null
          aprovado_por?: string | null
          cliente_id?: string
          competencia?: string
          created_at?: string | null
          documentos_processados?: number | null
          economia_vs_presumido?: number | null
          fator_r?: number | null
          folha_encargos?: number | null
          folha_total_bruto?: number | null
          gerado_em?: string | null
          guias_estaduais?: number | null
          guias_federais?: number | null
          guias_municipais?: number | null
          id?: string
          mes?: number
          modelo_ia?: string | null
          observacoes?: string | null
          presumido_base_irpj?: number | null
          presumido_cofins?: number | null
          presumido_csll?: number | null
          presumido_irpj?: number | null
          presumido_iss?: number | null
          presumido_pis?: number | null
          presumido_total?: number | null
          rbt12_calculado?: number | null
          receita_bruta_12_meses?: number | null
          receita_bruta_mes?: number | null
          regime_tributario_selecionado?: string | null
          secao1_faturamento?: Json | null
          secao2_financeiro?: Json | null
          secao3_documentos?: Json | null
          secao4_tabela_mensal?: Json | null
          secao5_acompanham?: Json | null
          secao6_analisados?: Json | null
          secao7_tributaria?: Json | null
          secao8_assinatura?: Json | null
          simples_aliquota_efetiva?: number | null
          simples_anexo?: string | null
          simples_cofins?: number | null
          simples_cpp?: number | null
          simples_csll?: number | null
          simples_deducao?: number | null
          simples_icms?: number | null
          simples_irpj?: number | null
          simples_iss?: number | null
          simples_pis?: number | null
          simples_valor_devido?: number | null
          status?: string | null
          tipo_parecer?: string | null
          tipo_relatorio?: string | null
          total_compras?: number | null
          total_impostos_retidos?: number | null
          total_notas_emitidas?: number | null
          total_notas_recebidas?: number | null
          updated_at?: string | null
          valor_notas_emitidas?: number | null
          valor_notas_recebidas?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "relatorios_fiscais_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes_pj"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      anexo_simples: "I" | "II" | "III" | "IV" | "V"
      app_role: "analista" | "revisor" | "admin"
      documento_status:
        | "pendente"
        | "processando"
        | "classificado"
        | "processado"
        | "erro"
      regime_tributario: "simples_nacional" | "lucro_presumido" | "lucro_real"
      tipo_documento:
        | "nfe"
        | "nfse"
        | "cte"
        | "pgdas"
        | "guia_federal"
        | "guia_estadual"
        | "guia_municipal"
        | "extrato_bancario"
        | "folha_pagamento"
        | "contrato"
        | "outros"
      tipo_estabelecimento: "MATRIZ" | "FILIAL"
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
    Enums: {
      anexo_simples: ["I", "II", "III", "IV", "V"],
      app_role: ["analista", "revisor", "admin"],
      documento_status: [
        "pendente",
        "processando",
        "classificado",
        "processado",
        "erro",
      ],
      regime_tributario: ["simples_nacional", "lucro_presumido", "lucro_real"],
      tipo_documento: [
        "nfe",
        "nfse",
        "cte",
        "pgdas",
        "guia_federal",
        "guia_estadual",
        "guia_municipal",
        "extrato_bancario",
        "folha_pagamento",
        "contrato",
        "outros",
      ],
      tipo_estabelecimento: ["MATRIZ", "FILIAL"],
    },
  },
} as const
