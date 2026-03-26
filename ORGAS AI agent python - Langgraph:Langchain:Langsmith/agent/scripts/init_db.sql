-- ORGAS AI - Database Initialization Script
-- PostgreSQL 15+
-- Executed automatically on first Docker container start

-- ============================================================================
-- Create Extensions
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- Create Schemas
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS public;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS cache;

-- ============================================================================
-- Sessions Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(255) NOT NULL,
    session_token VARCHAR(512) UNIQUE NOT NULL,

    -- Session metadata
    user_agent VARCHAR(1024),
    ip_address INET,
    user_name VARCHAR(255),
    regime_tributario VARCHAR(100),
    categoria VARCHAR(100),

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP + INTERVAL '30 days',

    -- Status
    is_active BOOLEAN DEFAULT true,

    -- Indexes
    CONSTRAINT valid_user_id CHECK (user_id != '')
);

CREATE INDEX idx_sessions_user_id ON public.sessions(user_id);
CREATE INDEX idx_sessions_session_token ON public.sessions(session_token);
CREATE INDEX idx_sessions_created_at ON public.sessions(created_at DESC);

-- ============================================================================
-- Messages Table (Chat History)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,

    -- Message content
    role VARCHAR(50) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,

    -- Metadata
    message_type VARCHAR(50) DEFAULT 'text',
    tokens_used INT DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Indexes
    CONSTRAINT non_empty_content CHECK (content != '')
);

CREATE INDEX idx_messages_session_id ON public.messages(session_id);
CREATE INDEX idx_messages_role ON public.messages(role);
CREATE INDEX idx_messages_created_at ON public.messages(created_at DESC);

-- ============================================================================
-- Agent Steps Table (Audit Trail)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.agent_steps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,

    -- Step details
    agent_name VARCHAR(100) NOT NULL,
    action VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),

    -- Result/Error
    result JSONB DEFAULT '{}',
    error TEXT,

    -- Metadata
    execution_time_ms INT,
    tokens_used INT DEFAULT 0,

    -- Timestamps
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,

    -- Indexes
    CONSTRAINT valid_action CHECK (action != '')
);

CREATE INDEX idx_agent_steps_session_id ON public.agent_steps(session_id);
CREATE INDEX idx_agent_steps_agent_name ON public.agent_steps(agent_name);
CREATE INDEX idx_agent_steps_status ON public.agent_steps(status);
CREATE INDEX idx_agent_steps_created_at ON public.agent_steps(started_at DESC);

-- ============================================================================
-- Documents/Files Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,

    -- File info
    filename VARCHAR(512) NOT NULL,
    mime_type VARCHAR(100),
    file_uri VARCHAR(1024),  -- Storage URI (e.g., files/xyz... from Gemini API)
    file_size_bytes BIGINT,

    -- Upload status
    upload_status VARCHAR(50) DEFAULT 'pending' CHECK (upload_status IN ('pending', 'processing', 'completed', 'failed')),
    upload_error TEXT,

    -- Processing
    processed BOOLEAN DEFAULT false,
    processed_at TIMESTAMP WITH TIME ZONE,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Metadata
    metadata JSONB DEFAULT '{}',

    -- Indexes
    CONSTRAINT valid_filename CHECK (filename != '')
);

CREATE INDEX idx_documents_session_id ON public.documents(session_id);
CREATE INDEX idx_documents_upload_status ON public.documents(upload_status);
CREATE INDEX idx_documents_created_at ON public.documents(created_at DESC);

-- ============================================================================
-- Analysis Results Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.analysis_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,

    -- Domain-specific analysis
    domain VARCHAR(100) NOT NULL CHECK (domain IN ('fiscal', 'accounting', 'personal', 'generic')),
    analysis_type VARCHAR(100),

    -- Results
    result_summary TEXT,
    result_details JSONB DEFAULT '{}',
    risks_identified JSONB DEFAULT '[]',
    recommendations JSONB DEFAULT '[]',

    -- Status
    status VARCHAR(50) DEFAULT 'completed' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Indexes
    CONSTRAINT valid_domain_analysis CHECK (analysis_type != '')
);

CREATE INDEX idx_analysis_results_session_id ON public.analysis_results(session_id);
CREATE INDEX idx_analysis_results_domain ON public.analysis_results(domain);
CREATE INDEX idx_analysis_results_status ON public.analysis_results(status);

-- ============================================================================
-- Audit Log Table (LGPD/GDPR Compliance)
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit.access_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID,

    -- Action details
    action VARCHAR(100) NOT NULL,
    resource VARCHAR(255),

    -- User info (masked for privacy)
    user_id_hash VARCHAR(255),
    ip_address_hash VARCHAR(255),

    -- Result
    success BOOLEAN,
    error_message TEXT,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Indexes
    CONSTRAINT valid_action CHECK (action != '')
);

CREATE INDEX idx_access_log_session_id ON audit.access_log(session_id);
CREATE INDEX idx_access_log_action ON audit.access_log(action);
CREATE INDEX idx_access_log_user_id_hash ON audit.access_log(user_id_hash);
CREATE INDEX idx_access_log_created_at ON audit.access_log(created_at DESC);

-- ============================================================================
-- PII Audit Log (LGPD Critical)
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit.pii_access_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID,

    -- PII action
    pii_type VARCHAR(50) NOT NULL CHECK (pii_type IN ('cpf', 'email', 'phone', 'address', 'birth_date', 'name')),
    action VARCHAR(100) NOT NULL CHECK (action IN ('accessed', 'masked', 'anonymized', 'removed')),

    -- Status
    compliant BOOLEAN DEFAULT true,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Indexes
    CONSTRAINT valid_pii_type CHECK (pii_type != '')
);

CREATE INDEX idx_pii_access_log_session_id ON audit.pii_access_log(session_id);
CREATE INDEX idx_pii_access_log_pii_type ON audit.pii_access_log(pii_type);
CREATE INDEX idx_pii_access_log_compliant ON audit.pii_access_log(compliant);

-- ============================================================================
-- Cache Table (Session cache)
-- ============================================================================

CREATE TABLE IF NOT EXISTS cache.session_cache (
    key VARCHAR(255) PRIMARY KEY,
    value JSONB NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_session_cache_expires_at ON cache.session_cache(expires_at);

-- ============================================================================
-- Update Timestamps Trigger (Auto-update updated_at)
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_sessions_updated_at BEFORE UPDATE ON public.sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_documents_updated_at BEFORE UPDATE ON public.documents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_analysis_results_updated_at BEFORE UPDATE ON public.analysis_results
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_session_cache_updated_at BEFORE UPDATE ON cache.session_cache
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Cleanup Expired Sessions (Archive old sessions daily)
-- ============================================================================

CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS void AS $$
BEGIN
    -- Mark expired sessions as inactive
    UPDATE public.sessions
    SET is_active = false
    WHERE expires_at < CURRENT_TIMESTAMP AND is_active = true;

    -- Delete old cache entries
    DELETE FROM cache.session_cache
    WHERE expires_at < CURRENT_TIMESTAMP;

    -- Log cleanup
    RAISE NOTICE 'Cleanup completed: expired sessions marked inactive, old cache purged';
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Grants (Set permissions)
-- ============================================================================

-- Create app user if not exists
DO $$ BEGIN
    CREATE ROLE app_user WITH LOGIN PASSWORD 'app_password' NOINHERIT;
EXCEPTION WHEN DUPLICATE_OBJECT THEN
    -- User already exists, skip
END $$;

-- Grant permissions
GRANT USAGE ON SCHEMA public, audit, cache TO app_user;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public, audit, cache TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public, audit, cache TO app_user;

-- ============================================================================
-- Sample Data (Optional - for testing)
-- ============================================================================

-- Insert sample session (uncomment to enable)
-- INSERT INTO public.sessions (user_id, session_token, user_name)
-- VALUES (
--     'user-test-001',
--     'token_' || uuid_generate_v4()::text,
--     'Test User'
-- ) ON CONFLICT DO NOTHING;

-- ============================================================================
-- Final Status
-- ============================================================================

-- Show created objects
SELECT 'Database initialization complete!' as status;
SELECT count(*) as table_count FROM information_schema.tables WHERE table_schema = 'public';
SELECT count(*) as index_count FROM information_schema.indexes WHERE schemaname = 'public';
