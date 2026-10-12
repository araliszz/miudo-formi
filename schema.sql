-- Banco novo. Não execute sobre o schema antigo; veja GUIA.md.
BEGIN;
CREATE TABLE IF NOT EXISTS usuarios (
 id SERIAL PRIMARY KEY, nome VARCHAR(120) NOT NULL,
 email VARCHAR(255) NOT NULL UNIQUE CHECK (email = lower(email)),
 telefone VARCHAR(15) NOT NULL CHECK (telefone ~ '^[0-9]{10,15}$'),
 senha_hash TEXT NOT NULL, email_verificado BOOLEAN NOT NULL DEFAULT false,
 criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS empresas (
 id SERIAL PRIMARY KEY, nome VARCHAR(150) NOT NULL,
 dias_inatividade INTEGER NOT NULL DEFAULT 14 CHECK (dias_inatividade BETWEEN 1 AND 365),
 meta_conversao NUMERIC(5,2) NOT NULL DEFAULT 20 CHECK (meta_conversao BETWEEN 0 AND 100),
 criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS membros (
 empresa_id INTEGER NOT NULL REFERENCES empresas(id),
 usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
 perfil VARCHAR(20) NOT NULL CHECK (perfil IN ('admin','usuario')),
 ativo BOOLEAN NOT NULL DEFAULT true, criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY (empresa_id, usuario_id)
);
CREATE TABLE IF NOT EXISTS tokens_email (
 id SERIAL PRIMARY KEY, usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
 token_hash VARCHAR(64) NOT NULL UNIQUE,
 finalidade VARCHAR(20) NOT NULL CHECK (finalidade IN ('verificar','redefinir')),
 expira_em TIMESTAMPTZ NOT NULL, usado_em TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS convites (
 id SERIAL PRIMARY KEY, empresa_id INTEGER NOT NULL REFERENCES empresas(id),
 criado_por INTEGER NOT NULL REFERENCES usuarios(id),
 email VARCHAR(255) NOT NULL, perfil VARCHAR(20) NOT NULL CHECK (perfil IN ('admin','usuario')),
 token_hash VARCHAR(64) NOT NULL UNIQUE, expira_em TIMESTAMPTZ NOT NULL,
 usado_em TIMESTAMPTZ, revogado_em TIMESTAMPTZ, aceito_por INTEGER REFERENCES usuarios(id),
 criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS leads (
 id SERIAL PRIMARY KEY, empresa_id INTEGER NOT NULL REFERENCES empresas(id),
 usuario_id INTEGER NOT NULL, nome VARCHAR(120) NOT NULL,
 telefone VARCHAR(15) NOT NULL CHECK (telefone ~ '^[0-9]{10,15}$'),
 email VARCHAR(255), origem VARCHAR(80) NOT NULL DEFAULT 'Manual',
 qualificacao VARCHAR(3) NOT NULL DEFAULT 'IQL' CHECK (qualificacao IN ('IQL','MQL','SQL','PQL')),
 temperatura VARCHAR(10) NOT NULL DEFAULT 'frio' CHECK (temperatura IN ('frio','morno','quente')),
 dificuldade VARCHAR(20) NOT NULL DEFAULT 'simples' CHECK (dificuldade IN ('simples','complexa','complexo_irregular')),
 etapa VARCHAR(20) NOT NULL DEFAULT 'captado' CHECK (etapa IN ('captado','trabalhado','convertido','inativo','perdido','cancelado')),
 observacoes TEXT NOT NULL DEFAULT '', motivo_perda TEXT NOT NULL DEFAULT '',
 trabalhado_em TIMESTAMPTZ, ultimo_contato_em TIMESTAMPTZ, ultima_resposta_em TIMESTAMPTZ,
 criado_em TIMESTAMPTZ NOT NULL DEFAULT now(), atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY (empresa_id,usuario_id) REFERENCES membros(empresa_id,usuario_id)
);
CREATE TABLE IF NOT EXISTS eventos (
 id SERIAL PRIMARY KEY, lead_id INTEGER NOT NULL REFERENCES leads(id),
 usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
 tipo VARCHAR(30) NOT NULL CHECK (tipo IN ('contato','resposta','visita_agendada','visita_realizada','contrato','perdido','inativo','cancelamento','reativacao','edicao')),
 detalhes TEXT NOT NULL DEFAULT '', criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS contratos (
 id SERIAL PRIMARY KEY, lead_id INTEGER NOT NULL UNIQUE REFERENCES leads(id),
 valor NUMERIC(12,2) NOT NULL CHECK (valor >= 0),
 recebido_inicial NUMERIC(12,2) NOT NULL CHECK (recebido_inicial >= 0 AND recebido_inicial <= valor),
 criado_por INTEGER NOT NULL REFERENCES usuarios(id), criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS acoes (
 id SERIAL PRIMARY KEY, lead_id INTEGER NOT NULL REFERENCES leads(id),
 titulo VARCHAR(200) NOT NULL, responsavel_id INTEGER NOT NULL REFERENCES usuarios(id),
 prazo TIMESTAMPTZ NOT NULL, concluida BOOLEAN NOT NULL DEFAULT false,
 concluida_em TIMESTAMPTZ, criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS session (
 sid VARCHAR PRIMARY KEY, sess JSON NOT NULL, expire TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_expire ON session(expire);
CREATE INDEX IF NOT EXISTS idx_leads_empresa_data ON leads(empresa_id,criado_em);
CREATE INDEX IF NOT EXISTS idx_eventos_lead ON eventos(lead_id,criado_em);
CREATE INDEX IF NOT EXISTS idx_acoes_prazo ON acoes(prazo);
CREATE INDEX IF NOT EXISTS idx_convites_empresa ON convites(empresa_id);
COMMIT;

-- Atualização compatível com a versão 2.0 (não altera nem apaga dados).
BEGIN;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS suspensa BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tokens_email ADD COLUMN IF NOT EXISTS session_binding_hash VARCHAR(64);
ALTER TABLE tokens_email DROP CONSTRAINT IF EXISTS tokens_email_finalidade_check;
ALTER TABLE tokens_email ADD CONSTRAINT tokens_email_finalidade_check CHECK(finalidade IN ('verificar','redefinir','acesso_dono'));
CREATE TABLE IF NOT EXISTS security_rate_limits (
 chave VARCHAR(64) NOT NULL, janela VARCHAR(20) NOT NULL,
 contador INTEGER NOT NULL, expira_em TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(chave,janela)
);
CREATE INDEX IF NOT EXISTS idx_rate_expire ON security_rate_limits(expira_em);
CREATE TABLE IF NOT EXISTS auditoria (
 id BIGSERIAL PRIMARY KEY, usuario_id INTEGER REFERENCES usuarios(id),
 empresa_id INTEGER REFERENCES empresas(id), evento VARCHAR(80) NOT NULL,
 detalhes JSONB NOT NULL DEFAULT '{}', criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auditoria_empresa ON auditoria(empresa_id,criado_em);
COMMIT;

-- Data real de captação separada do registro automático no FORMI.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS data_captacao DATE;
UPDATE leads SET data_captacao=(criado_em AT TIME ZONE 'America/Sao_Paulo')::date WHERE data_captacao IS NULL;
ALTER TABLE leads ALTER COLUMN data_captacao SET DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo')::date);
ALTER TABLE leads ALTER COLUMN data_captacao SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_empresa_captacao ON leads(empresa_id,data_captacao);

-- Situação manual do contato: independente dos contratos e das automações.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS situacao_lead VARCHAR(20) NOT NULL DEFAULT 'captado'
 CHECK (situacao_lead IN ('captado','trabalhado','convertido','inativo','perdido'));
