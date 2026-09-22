// Máscaras e validação de CPF/CNPJ e telefone pra tela "Meus dados". A
// validação confere tanto a quantidade de dígitos quanto o dígito
// verificador de verdade (não é só "tem 11 ou 14 números").

export function apenasDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

export function formatarDocumento(valor: string): string {
  const d = apenasDigitos(valor).slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  }
  return d
    .replace(/(\d{2})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

export function formatarTelefone(valor: string): string {
  const d = apenasDigitos(valor).slice(0, 11);
  if (d.length <= 10) {
    return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d{1,4})$/, "$1-$2");
  }
  return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d{1,4})$/, "$1-$2");
}

function validarCPF(digitos: string): boolean {
  if (digitos.length !== 11 || /^(\d)\1{10}$/.test(digitos)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += Number(digitos[i]) * (10 - i);
  let resto = (soma * 10) % 11;
  if (resto >= 10) resto = 0;
  if (resto !== Number(digitos[9])) return false;

  soma = 0;
  for (let i = 0; i < 10; i++) soma += Number(digitos[i]) * (11 - i);
  resto = (soma * 10) % 11;
  if (resto >= 10) resto = 0;
  return resto === Number(digitos[10]);
}

function validarCNPJ(digitos: string): boolean {
  if (digitos.length !== 14 || /^(\d)\1{13}$/.test(digitos)) return false;

  const calcularDigito = (base: string) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = base.split("").reduce((acc, char, i) => acc + Number(char) * pesos[i], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const base = digitos.slice(0, 12);
  const dv1 = calcularDigito(base);
  const dv2 = calcularDigito(base + dv1);
  return digitos === base + String(dv1) + String(dv2);
}

/** Aceita CPF (11 dígitos) ou CNPJ (14 dígitos), com dígito verificador válido. */
export function documentoValido(valor: string): boolean {
  const d = apenasDigitos(valor);
  if (d.length === 11) return validarCPF(d);
  if (d.length === 14) return validarCNPJ(d);
  return false;
}

export function tipoDocumento(valor: string): "cpf" | "cnpj" | null {
  const d = apenasDigitos(valor);
  if (d.length === 11) return "cpf";
  if (d.length === 14) return "cnpj";
  return null;
}

/** Telefone BR: DDD (2) + número (8 fixo ou 9 celular) = 10 ou 11 dígitos. */
export function telefoneValido(valor: string): boolean {
  const d = apenasDigitos(valor);
  return d.length === 10 || d.length === 11;
}

export function emailValido(valor: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor.trim());
}
