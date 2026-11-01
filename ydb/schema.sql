-- Таблицы продукта. Регион базы — ru-central1.
-- То же самое создаёт Terraform (infra/terraform/ydb.tf).
-- Этот файл нужен, чтобы прочитать схему глазами или вставить её
-- в редактор YDB, если таблицы создаются вручную вместо Terraform.
-- Повторно выполнять вместе с Terraform не нужно: таблицы уже будут.

CREATE TABLE masters (
    slug Utf8 NOT NULL,
    chat_id Utf8 NOT NULL,
    telegram_user_id Utf8 NOT NULL,
    profile_json Utf8 NOT NULL,
    published Bool NOT NULL,
    created_at Utf8 NOT NULL,
    updated_at Utf8 NOT NULL,
    PRIMARY KEY (slug)
);

CREATE TABLE masters_by_chat (
    chat_id Utf8 NOT NULL,
    slug Utf8 NOT NULL,
    PRIMARY KEY (chat_id)
);

CREATE TABLE bookings (
    slug Utf8 NOT NULL,
    created_at Utf8 NOT NULL,
    booking_id Utf8 NOT NULL,
    slot_key Utf8 NOT NULL,
    client_name Utf8 NOT NULL,
    client_phone Utf8 NOT NULL,
    service_name Utf8 NOT NULL,
    service_price Uint32 NOT NULL,
    service_dur Utf8 NOT NULL,
    date_iso Utf8 NOT NULL,
    time_hhmm Utf8 NOT NULL,
    date_text Utf8 NOT NULL,
    status Utf8 NOT NULL,
    tg_message_id Utf8 NOT NULL,
    updated_at Utf8 NOT NULL,
    PRIMARY KEY (slug, created_at, booking_id)
);

CREATE TABLE bookings_by_id (
    booking_id Utf8 NOT NULL,
    slug Utf8 NOT NULL,
    created_at Utf8 NOT NULL,
    slot_key Utf8 NOT NULL,
    client_name Utf8 NOT NULL,
    client_phone Utf8 NOT NULL,
    service_name Utf8 NOT NULL,
    service_price Uint32 NOT NULL,
    service_dur Utf8 NOT NULL,
    date_iso Utf8 NOT NULL,
    time_hhmm Utf8 NOT NULL,
    date_text Utf8 NOT NULL,
    status Utf8 NOT NULL,
    tg_message_id Utf8 NOT NULL,
    updated_at Utf8 NOT NULL,
    PRIMARY KEY (booking_id)
);

CREATE TABLE slot_holds (
    slug Utf8 NOT NULL,
    slot_key Utf8 NOT NULL,
    booking_id Utf8 NOT NULL,
    PRIMARY KEY (slug, slot_key)
);

CREATE TABLE rate_limits (
    bucket Utf8 NOT NULL,
    window_start Utf8 NOT NULL,
    count Uint32 NOT NULL,
    PRIMARY KEY (bucket, window_start)
);

CREATE TABLE login_tokens (
    jti Utf8 NOT NULL,
    slug Utf8 NOT NULL,
    chat_id Utf8 NOT NULL,
    exp Utf8 NOT NULL,
    PRIMARY KEY (jti)
);

CREATE TABLE bot_state (
    chat_id Utf8 NOT NULL,
    step Utf8 NOT NULL,
    PRIMARY KEY (chat_id)
);
