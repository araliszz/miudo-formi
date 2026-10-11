-- Migração aditiva e repetível: mantém contatos, contratos e histórico 2.x.
BEGIN;
CREATE TABLE IF NOT EXISTS crm_migracoes (versao TEXT PRIMARY KEY, criado_em TIMESTAMPTZ NOT NULL DEFAULT now());
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS crm_config JSONB NOT NULL DEFAULT '{"origens":["Manual","Instagram","Indicação","Site"],"etiquetas":[],"campos":[],"lembrete_minutos":60,"automacao_visita":true,"automacao_inatividade":true}';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS etiquetas JSONB NOT NULL DEFAULT '[]';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS campos JSONB NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS crm_etapas (
 id SERIAL PRIMARY KEY, empresa_id INTEGER NOT NULL REFERENCES empresas(id), nome VARCHAR(80) NOT NULL,
 ordem INTEGER NOT NULL, tipo VARCHAR(10) NOT NULL CHECK(tipo IN ('aberta','ganha','perdida')),
 UNIQUE(empresa_id,nome), UNIQUE(empresa_id,id)
);
INSERT INTO crm_etapas(empresa_id,nome,ordem,tipo)
 SELECT e.id,s.nome,s.ordem,s.tipo FROM empresas e CROSS JOIN (VALUES
 ('Novo contato',0,'aberta'),('Em atendimento',1,'aberta'),('Visita agendada',2,'aberta'),('Proposta',3,'aberta'),('Fechado',4,'ganha'),('Perdido',5,'perdida')) s(nome,ordem,tipo)
 WHERE NOT EXISTS(SELECT 1 FROM crm_etapas x WHERE x.empresa_id=e.id);
CREATE TABLE IF NOT EXISTS oportunidades (
 id SERIAL PRIMARY KEY, empresa_id INTEGER NOT NULL REFERENCES empresas(id), lead_id INTEGER NOT NULL REFERENCES leads(id),
 titulo VARCHAR(160) NOT NULL, etapa_id INTEGER NOT NULL, valor NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK(valor>=0),
 previsao DATE, motivo_perda TEXT NOT NULL DEFAULT '', legado_lead_id INTEGER UNIQUE REFERENCES leads(id),
 criado_em TIMESTAMPTZ NOT NULL DEFAULT now(), etapa_em TIMESTAMPTZ NOT NULL DEFAULT now(), fechado_em TIMESTAMPTZ,
 FOREIGN KEY(empresa_id,etapa_id) REFERENCES crm_etapas(empresa_id,id)
);
CREATE TABLE IF NOT EXISTS crm_contratos (
 id SERIAL PRIMARY KEY, oportunidade_id INTEGER NOT NULL UNIQUE REFERENCES oportunidades(id),
 valor NUMERIC(12,2) NOT NULL CHECK(valor>=0), criado_por INTEGER NOT NULL REFERENCES usuarios(id),
 legado_id INTEGER UNIQUE REFERENCES contratos(id), cancelado_em TIMESTAMPTZ, criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS crm_recebimentos (
 id SERIAL PRIMARY KEY, contrato_id INTEGER NOT NULL REFERENCES crm_contratos(id), valor NUMERIC(12,2) NOT NULL CHECK(valor>0),
 descricao VARCHAR(160) NOT NULL, criado_por INTEGER NOT NULL REFERENCES usuarios(id), criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
 legado_id INTEGER UNIQUE REFERENCES contratos(id)
);
CREATE TABLE IF NOT EXISTS crm_movimentos (
 id SERIAL PRIMARY KEY, oportunidade_id INTEGER NOT NULL REFERENCES oportunidades(id), etapa_id INTEGER NOT NULL REFERENCES crm_etapas(id),
 usuario_id INTEGER NOT NULL REFERENCES usuarios(id), criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS crm_notas (
 id SERIAL PRIMARY KEY, lead_id INTEGER NOT NULL REFERENCES leads(id), usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
 texto TEXT NOT NULL, criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS crm_anexos (
 id SERIAL PRIMARY KEY, lead_id INTEGER NOT NULL REFERENCES leads(id), usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
 nome VARCHAR(180) NOT NULL, dados BYTEA NOT NULL, tamanho INTEGER NOT NULL CHECK(tamanho BETWEEN 1 AND 2097152),
 criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS crm_modelos (
 id SERIAL PRIMARY KEY, empresa_id INTEGER NOT NULL REFERENCES empresas(id), nome VARCHAR(80) NOT NULL,
 texto TEXT NOT NULL, UNIQUE(empresa_id,nome)
);
CREATE TABLE IF NOT EXISTS crm_alertas (
 id SERIAL PRIMARY KEY, empresa_id INTEGER NOT NULL REFERENCES empresas(id), usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
 lead_id INTEGER REFERENCES leads(id), chave TEXT NOT NULL UNIQUE, titulo VARCHAR(200) NOT NULL,
 lido BOOLEAN NOT NULL DEFAULT false, criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS crm_fila_email (
 id SERIAL PRIMARY KEY, empresa_id INTEGER NOT NULL REFERENCES empresas(id), usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
 destino VARCHAR(255), chave TEXT NOT NULL UNIQUE, assunto VARCHAR(200) NOT NULL, texto TEXT NOT NULL, link TEXT NOT NULL,
 tentativas INTEGER NOT NULL DEFAULT 0, disponivel_em TIMESTAMPTZ NOT NULL DEFAULT now(), enviado_em TIMESTAMPTZ,
 criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO oportunidades(empresa_id,lead_id,titulo,etapa_id,valor,legado_lead_id,criado_em,fechado_em)
 SELECT l.empresa_id,l.id,'Negociação de '||l.nome,s.id,coalesce(c.valor,0),l.id,l.criado_em,
 CASE WHEN c.id IS NOT NULL OR l.etapa='perdido' THEN coalesce(c.criado_em,l.atualizado_em) END
 FROM leads l LEFT JOIN contratos c ON c.lead_id=l.id JOIN crm_etapas s ON s.empresa_id=l.empresa_id AND s.nome=
 CASE WHEN c.id IS NOT NULL THEN 'Fechado' WHEN l.etapa='perdido' THEN 'Perdido' WHEN l.trabalhado_em IS NOT NULL THEN 'Em atendimento' ELSE 'Novo contato' END
 WHERE NOT EXISTS(SELECT 1 FROM crm_migracoes WHERE versao='3.0')
 ON CONFLICT(legado_lead_id) DO NOTHING;
INSERT INTO crm_contratos(oportunidade_id,valor,criado_por,legado_id,cancelado_em,criado_em)
 SELECT o.id,c.valor,c.criado_por,c.id,CASE WHEN l.etapa='cancelado' THEN l.atualizado_em END,c.criado_em
 FROM contratos c JOIN oportunidades o ON o.legado_lead_id=c.lead_id JOIN leads l ON l.id=c.lead_id
 ON CONFLICT(legado_id) DO NOTHING;
INSERT INTO crm_recebimentos(contrato_id,valor,descricao,criado_por,criado_em,legado_id)
 SELECT n.id,c.recebido_inicial,'Entrada migrada da versão 2',c.criado_por,c.criado_em,c.id
 FROM contratos c JOIN crm_contratos n ON n.legado_id=c.id WHERE c.recebido_inicial>0
 ON CONFLICT(legado_id) DO NOTHING;
CREATE INDEX IF NOT EXISTS idx_oportunidades_empresa ON oportunidades(empresa_id,etapa_id);
CREATE INDEX IF NOT EXISTS idx_fila_pendente ON crm_fila_email(disponivel_em) WHERE enviado_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_alertas_usuario ON crm_alertas(empresa_id,usuario_id,criado_em);
INSERT INTO crm_migracoes(versao) VALUES('3.0') ON CONFLICT DO NOTHING;
COMMIT;
