import { apenasDigitos } from "./validacao";

export function formatarCep(valor: string): string {
  const d = apenasDigitos(valor).slice(0, 8);
  return d.replace(/(\d{5})(\d{1,3})$/, "$1-$2");
}

export function cepValido(valor: string): boolean {
  return apenasDigitos(valor).length === 8;
}

export type EnderecoViaCep = {
  logradouro: string;
  bairro: string;
  localidade: string;
  uf: string;
  erro?: boolean;
};

/** Busca o endereço pelo CEP na ViaCEP (serviço público, gratuito, sem chave). Retorna null se o CEP não existir ou a busca falhar. */
export async function buscarEnderecoPorCep(cep: string): Promise<EnderecoViaCep | null> {
  const digitos = apenasDigitos(cep);
  if (digitos.length !== 8) return null;
  try {
    const resp = await fetch(`https://viacep.com.br/ws/${digitos}/json/`);
    if (!resp.ok) return null;
    const data = (await resp.json()) as EnderecoViaCep;
    if (data.erro) return null;
    return data;
  } catch {
    return null;
  }
}
