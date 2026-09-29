-- Map the 29 Hindi/Spanish/German voice characters to native premade voices
-- added to the user's ElevenLabs account voice library on 2026-09-29.
-- Voice IDs were copied from the account's own "My Voices" via "Copy voice ID".
-- (The 11 English mappings were applied by 20260929060000.)

-- Hindi (10)
UPDATE public.voice_characters SET provider_voice_id = 'k0gtD0Bbpi6hL40jfHfm', status = 'mapped' WHERE id = 'niraj';
UPDATE public.voice_characters SET provider_voice_id = 'HH8sIQq8WOcER3Nu118i', status = 'mapped' WHERE id = 'raju';
UPDATE public.voice_characters SET provider_voice_id = 'JlfM9BOUS7FcsHfTqsAy', status = 'mapped' WHERE id = 'aakash';
UPDATE public.voice_characters SET provider_voice_id = '3OUAuH7CeDSQhCCijs1Y', status = 'mapped' WHERE id = 'bunty';
UPDATE public.voice_characters SET provider_voice_id = 'OtEfb2LVzIE45wdYe54M', status = 'mapped' WHERE id = 'monika-sogam';
UPDATE public.voice_characters SET provider_voice_id = 'Be3X8pg7kLN4vyyMC3QN', status = 'mapped' WHERE id = 'kali-devi';
UPDATE public.voice_characters SET provider_voice_id = 'T3s9anIvGvoeogXyFyMt', status = 'mapped' WHERE id = 'krishna-gupta';
UPDATE public.voice_characters SET provider_voice_id = 'o6qTxWUeRyzRYZyUNDVJ', status = 'mapped' WHERE id = 'devi';
UPDATE public.voice_characters SET provider_voice_id = 'F8IvasoAdpDhOjLm5YBm', status = 'mapped' WHERE id = 'vikram';
UPDATE public.voice_characters SET provider_voice_id = 'Aano0MRpH01ekWzUtv60', status = 'mapped' WHERE id = 'vikrant';

-- Spanish (10)
UPDATE public.voice_characters SET provider_voice_id = 'DdKbXdRlBmj7Ty7N0FVr', status = 'mapped' WHERE id = 'miguel';
UPDATE public.voice_characters SET provider_voice_id = 'hyKxCTlAqtnW188CgltM', status = 'mapped' WHERE id = 'alberto-rodriguez';
UPDATE public.voice_characters SET provider_voice_id = 'uCQe5kObQIjtylU0HL3m', status = 'mapped' WHERE id = 'david-martin';
UPDATE public.voice_characters SET provider_voice_id = 'YqZLNYWZm98oKaaLZkUA', status = 'mapped' WHERE id = 'carmelo';
UPDATE public.voice_characters SET provider_voice_id = 'MjtZn5tagxL1RO6w9ER5', status = 'mapped' WHERE id = 'fernando-martinez';
UPDATE public.voice_characters SET provider_voice_id = 'Wl3O9lmFSMgGFTTwuS6f', status = 'mapped' WHERE id = 'enrique-mondragon';
UPDATE public.voice_characters SET provider_voice_id = '94zOad0g7T7K4oa7zhDq', status = 'mapped' WHERE id = 'antonio';
UPDATE public.voice_characters SET provider_voice_id = 'zR7eV8hMFnxhSSAcCYW0', status = 'mapped' WHERE id = 'agustin';
UPDATE public.voice_characters SET provider_voice_id = 'uDhfdG2VwEjWZ4JYzggn', status = 'mapped' WHERE id = 'sara-martin';
UPDATE public.voice_characters SET provider_voice_id = 'K3TeN3ZVK8WnOeJ0NYqZ', status = 'mapped' WHERE id = 'el-faraon';

-- German (9; elli was already mapped)
UPDATE public.voice_characters SET provider_voice_id = 're2r5d74PqDzicySNW0I', status = 'mapped' WHERE id = 'leon-stern';
UPDATE public.voice_characters SET provider_voice_id = 'Fghah4fztZORbiKfIGAs', status = 'mapped' WHERE id = 'helmut-stieglbauer';
UPDATE public.voice_characters SET provider_voice_id = 'z1EhmmPwF0ENGYE8dBE6', status = 'mapped' WHERE id = 'christian';
UPDATE public.voice_characters SET provider_voice_id = 'FTNCalFNG5bRnkkaP5Ug', status = 'mapped' WHERE id = 'otto';
UPDATE public.voice_characters SET provider_voice_id = 'dCnu06FiOZma2KVNUoPZ', status = 'mapped' WHERE id = 'mila';
UPDATE public.voice_characters SET provider_voice_id = 'MbbPUteESkJWr4IAaW35', status = 'mapped' WHERE id = 'benjamin';
UPDATE public.voice_characters SET provider_voice_id = 'aTTiK3YzK3dXETpuDE2h', status = 'mapped' WHERE id = 'toby';
UPDATE public.voice_characters SET provider_voice_id = '7eVMgwCnXydb3CikjV7a', status = 'mapped' WHERE id = 'sissi';
UPDATE public.voice_characters SET provider_voice_id = 'PnDjdkPdsPizyMoHbJma', status = 'mapped' WHERE id = 'thorsten';
