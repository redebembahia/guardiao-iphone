# Guardião iPhone

Aplicativo da web instalável (PWA), adaptado para o iPhone 14 Pro Max. Funciona sem cadastro, publicidade, telemetria ou servidor que receba os dados do diagnóstico.

O modelo é configurado para esta análise pelo proprietário; o Safari identifica o sistema e o modo de abertura, mas não confirma o modelo exato do iPhone.

## Funções

- leitura automática local de capturas de Armazenamento e Saúde da Bateria;
- revisão obrigatória dos valores reconhecidos antes do diagnóstico;
- formulário guiado como alternativa quando uma tela não puder ser lida;
- índice estimado por regras locais, determinísticas e versionadas;
- recomendações priorizadas sem exclusão automática;
- histórico local das últimas 30 análises;
- relatório compartilhável pela folha nativa do iOS;
- análise opcional do tamanho agregado de arquivos escolhidos pelo usuário;
- funcionamento offline depois que o leitor conclui a preparação inicial com internet;
- interface ajustada às áreas seguras e à Dynamic Island.

## Como funciona a automação

1. O proprietário tira capturas de `Ajustes › Geral › Armazenamento do iPhone` e `Ajustes › Bateria › Saúde da Bateria e Carregamento`.
2. O app usa OCR local em WebAssembly para reconhecer somente os campos necessários.
3. Os valores são exibidos para conferência e podem ser corrigidos.
4. A captura e o texto bruto são descartados; somente os valores confirmados entram no histórico.

No primeiro uso automático, mantenha a internet conectada até a leitura terminar para que o navegador prepare os componentes locais do próprio aplicativo. Depois de uma leitura concluída, o navegador pode reutilizá-los offline.

## Limites do iOS

O Safari não permite que uma PWA leia silenciosamente o armazenamento geral, a lista de aplicativos, a RAM, a temperatura interna ou a capacidade máxima da bateria. Por isso, a automação depende de capturas escolhidas pelo proprietário. O Guardião não possui botões para apagar arquivos, limpar cache ou alterar configurações sozinho.

## Metodologia do índice

A versão 1.2.0 começa em 100 e aplica reduções determinísticas por armazenamento, bateria, temperatura, drenagem, sintomas e atualização. Os pesos máximos são: armazenamento 35; bateria 25; temperatura 25; drenagem 10; sintomas 15; atualização 5. A margem de 15% de armazenamento é uma meta preventiva adotada pelo Guardião, não uma exigência oficial do iOS. A cor visual também considera a pior prioridade: alerta crítico é vermelho e prioridade alta é, no mínimo, amarela.

## Privacidade do OCR

- Tesseract.js e o modelo de leitura são hospedados no próprio projeto, sem CDN.
- A imagem é processada sequencialmente em memória e nunca entra no IndexedDB.
- O texto reconhecido não é salvo nem enviado.
- O parser aceita somente campos estruturados de diagnóstico; nomes reconhecidos são limitados e sempre exibidos para conferência.
- O formulário manual permanece disponível como contingência.

Tesseract.js, Tesseract Core e tessdata usam Apache 2.0; os bundles também preservam avisos MIT e BSD-3-Clause de dependências incorporadas. Consulte `THIRD_PARTY_LICENSES.md`.

## Instalação no iPhone

1. Abra o endereço HTTPS no Safari.
2. Toque em **Compartilhar**.
3. Escolha **Adicionar à Tela de Início**.
4. Mantenha **Abrir como App** ativado.
5. Toque em **Adicionar**.

## Publicação gratuita no GitHub Pages

1. Crie um repositório público e envie todos os arquivos desta pasta, incluindo `.github`.
2. Abra **Settings › Pages** no repositório.
3. Em **Build and deployment › Source**, escolha **GitHub Actions**.
4. Abra **Actions** e aguarde o fluxo **Publicar Guardião iPhone** terminar.
5. Use o endereço HTTPS exibido no fluxo para instalar pelo Safari.

O código público contém apenas a interface e as regras do aplicativo. O histórico e os dados preenchidos continuam no navegador do iPhone.

Antes de publicar, o fluxo automatizado executa testes do parser, das regras de diagnóstico e do OCR real nas dimensões usadas pelo aplicativo:

```bash
npm ci
npm run prepare:vendor
npm test
```

O fluxo monta os componentes OCR a partir das versões fixadas no `package-lock.json`, baixa o modelo português de um commit imutável do projeto oficial e valida todos os hashes antes de publicar. O pacote instalável desta pasta já inclui esses componentes.

## Desenvolvimento local

Sirva esta pasta por HTTPS ou por um servidor local. Service Workers não funcionam ao abrir `index.html` diretamente como arquivo.
