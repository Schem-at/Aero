# Packet IDs — Protocol 774 (Minecraft 1.21.11)

Sources:
- [PrismarineJS/minecraft-data](https://github.com/PrismarineJS/minecraft-data/tree/master/data/pc/1.21.11)
- [Pumpkin-MC/Pumpkin](https://github.com/Pumpkin-MC/Pumpkin) (`pumpkin-data/src/generated/packet.rs`)

Pumpkin constant names shown in parentheses where available.

## Clientbound Play Packets

| Hex  | Dec | Name                          | Used by Aero |
|------|-----|-------------------------------|:---:|
| 0x00 | 0   | bundle_delimiter              |     |
| 0x01 | 1   | spawn_entity                  | yes |
| 0x02 | 2   | animation                     |     |
| 0x03 | 3   | statistics                    |     |
| 0x04 | 4   | acknowledge_player_digging    | yes |
| 0x05 | 5   | block_break_animation         |     |
| 0x06 | 6   | tile_entity_data              |     |
| 0x07 | 7   | block_action                  |     |
| 0x08 | 8   | block_change                  |     |
| 0x09 | 9   | boss_bar                      |     |
| 0x0A | 10  | difficulty                    |     |
| 0x0B | 11  | chunk_batch_finished          | yes |
| 0x0C | 12  | chunk_batch_start             | yes |
| 0x0D | 13  | chunk_biomes                  |     |
| 0x0E | 14  | clear_titles                  |     |
| 0x0F | 15  | tab_complete                  |     |
| 0x10 | 16  | declare_commands              | yes |
| 0x11 | 17  | close_window                  |     |
| 0x12 | 18  | window_items                  |     |
| 0x13 | 19  | craft_progress_bar            |     |
| 0x14 | 20  | set_slot                      |     |
| 0x15 | 21  | cookie_request                |     |
| 0x16 | 22  | set_cooldown                  |     |
| 0x17 | 23  | chat_suggestions              |     |
| 0x18 | 24  | custom_payload                |     |
| 0x19 | 25  | damage_event                  |     |
| 0x1A | 26  | debug_block_value             |     |
| 0x1B | 27  | debug_chunk_value             |     |
| 0x1C | 28  | debug_entity_value            |     |
| 0x1D | 29  | debug_event                   |     |
| 0x1E | 30  | debug_sample                  |     |
| 0x1F | 31  | hide_message                  |     |
| 0x20 | 32  | kick_disconnect               | yes |
| 0x21 | 33  | profileless_chat              |     |
| 0x22 | 34  | entity_status                 |     |
| 0x23 | 35  | sync_entity_position          |     |
| 0x24 | 36  | explosion                     |     |
| 0x25 | 37  | unload_chunk                  |     |
| 0x26 | 38  | game_state_change             | yes |
| 0x27 | 39  | game_test_highlight_pos       |     |
| 0x28 | 40  | open_horse_window             |     |
| 0x29 | 41  | hurt_animation                |     |
| 0x2A | 42  | initialize_world_border       |     |
| 0x2B | 43  | keep_alive                    | yes |
| 0x2C | 44  | map_chunk                     | yes |
| 0x2D | 45  | world_event                   |     |
| 0x2E | 46  | world_particles               |     |
| 0x2F | 47  | update_light                  |     |
| 0x30 | 48  | login                         | yes |
| 0x31 | 49  | map                           |     |
| 0x32 | 50  | trade_list                    |     |
| 0x33 | 51  | rel_entity_move               |     |
| 0x34 | 52  | entity_move_look              |     |
| 0x35 | 53  | move_minecart                 |     |
| 0x36 | 54  | entity_look                   |     |
| 0x37 | 55  | vehicle_move                  |     |
| 0x38 | 56  | open_book                     |     |
| 0x39 | 57  | open_window                   |     |
| 0x3A | 58  | open_sign_entity              |     |
| 0x3B | 59  | ping                          |     |
| 0x3C | 60  | ping_response                 |     |
| 0x3D | 61  | craft_recipe_response         |     |
| 0x3E | 62  | abilities                     | yes |
| 0x3F | 63  | player_chat                   |     |
| 0x40 | 64  | end_combat_event              |     |
| 0x41 | 65  | enter_combat_event            |     |
| 0x42 | 66  | death_combat_event            |     |
| 0x43 | 67  | player_remove                 | yes |
| 0x44 | 68  | player_info                   | yes |
| 0x45 | 69  | face_player                   |     |
| 0x46 | 70  | position                      | yes |
| 0x47 | 71  | player_rotation               |     |
| 0x48 | 72  | recipe_book_add               |     |
| 0x49 | 73  | recipe_book_remove            |     |
| 0x4A | 74  | recipe_book_settings          |     |
| 0x4B | 75  | entity_destroy                | yes |
| 0x4C | 76  | remove_entity_effect          |     |
| 0x4D | 77  | reset_score                   |     |
| 0x4E | 78  | remove_resource_pack          |     |
| 0x4F | 79  | add_resource_pack             |     |
| 0x50 | 80  | respawn                       |     |
| 0x51 | 81  | entity_head_rotation          | yes |
| 0x52 | 82  | multi_block_change            |     |
| 0x53 | 83  | select_advancement_tab        |     |
| 0x54 | 84  | server_data                   |     |
| 0x55 | 85  | action_bar                    |     |
| 0x56 | 86  | world_border_center           |     |
| 0x57 | 87  | world_border_lerp_size        |     |
| 0x58 | 88  | world_border_size             |     |
| 0x59 | 89  | world_border_warning_delay    |     |
| 0x5A | 90  | world_border_warning_reach    |     |
| 0x5B | 91  | camera                        |     |
| 0x5C | 92  | update_view_position          | yes |
| 0x5D | 93  | update_view_distance          |     |
| 0x5E | 94  | set_cursor_item               |     |
| 0x5F | 95  | spawn_position                | yes |
| 0x60 | 96  | scoreboard_display_objective  |     |
| 0x61 | 97  | entity_metadata               |     |
| 0x62 | 98  | attach_entity                 |     |
| 0x63 | 99  | entity_velocity               |     |
| 0x64 | 100 | entity_equipment              |     |
| 0x65 | 101 | experience                    |     |
| 0x66 | 102 | update_health                 |     |
| 0x67 | 103 | held_item_slot                |     |
| 0x68 | 104 | scoreboard_objective          |     |
| 0x69 | 105 | set_passengers                |     |
| 0x6A | 106 | set_player_inventory          |     |
| 0x6B | 107 | teams                         |     |
| 0x6C | 108 | scoreboard_score              |     |
| 0x6D | 109 | simulation_distance           |     |
| 0x6E | 110 | set_title_subtitle            |     |
| 0x6F | 111 | update_time                   | yes |
| 0x70 | 112 | set_title_text                |     |
| 0x71 | 113 | set_title_time                |     |
| 0x72 | 114 | entity_sound_effect           |     |
| 0x73 | 115 | sound_effect                  |     |
| 0x74 | 116 | start_configuration           |     |
| 0x75 | 117 | stop_sound                    |     |
| 0x76 | 118 | store_cookie                  |     |
| 0x77 | 119 | system_chat                   | yes |
| 0x78 | 120 | playerlist_header             |     |
| 0x79 | 121 | nbt_query_response            |     |
| 0x7A | 122 | collect                       |     |
| 0x7B | 123 | entity_teleport               | yes |
| 0x7C | 124 | test_instance_block_status    |     |
| 0x7D | 125 | set_ticking_state             |     |
| 0x7E | 126 | step_tick                     |     |
| 0x7F | 127 | transfer                      |     |
| 0x80 | 128 | advancements                  |     |
| 0x81 | 129 | entity_update_attributes      |     |
| 0x82 | 130 | entity_effect                 |     |
| 0x83 | 131 | declare_recipes               |     |
| 0x84 | 132 | tags                          |     |
| 0x85 | 133 | set_projectile_power          |     |
| 0x86 | 134 | custom_report_details         |     |
| 0x87 | 135 | server_links                  |     |
| 0x88 | 136 | tracked_waypoint              |     |
| 0x89 | 137 | clear_dialog                  |     |
| 0x8A | 138 | show_dialog                   |     |

## Serverbound Play Packets

| Hex  | Dec | Name                          | Used by Aero |
|------|-----|-------------------------------|:---:|
| 0x00 | 0   | teleport_confirm              | yes |
| 0x01 | 1   | query_block_nbt               |     |
| 0x02 | 2   | select_bundle_item            |     |
| 0x03 | 3   | set_difficulty                |     |
| 0x04 | 4   | change_gamemode               |     |
| 0x05 | 5   | message_acknowledgement       |     |
| 0x06 | 6   | chat_command                  | yes |
| 0x07 | 7   | chat_command_signed           |     |
| 0x08 | 8   | chat_message                  | yes |
| 0x09 | 9   | chat_session_update           | yes |
| 0x0A | 10  | chunk_batch_received          | yes |
| 0x0B | 11  | client_command                |     |
| 0x0C | 12  | tick_end                      | yes |
| 0x0D | 13  | settings                      | yes |
| 0x0E | 14  | tab_complete                  |     |
| 0x0F | 15  | configuration_acknowledged    | yes |
| 0x10 | 16  | enchant_item                  |     |
| 0x11 | 17  | window_click                  |     |
| 0x12 | 18  | close_window                  |     |
| 0x13 | 19  | set_slot_state                |     |
| 0x14 | 20  | cookie_response               |     |
| 0x15 | 21  | custom_payload                | yes |
| 0x16 | 22  | debug_subscription_request    |     |
| 0x17 | 23  | edit_book                     |     |
| 0x18 | 24  | query_entity_nbt              |     |
| 0x19 | 25  | use_entity                    |     |
| 0x1A | 26  | generate_structure            |     |
| 0x1B | 27  | keep_alive                    | yes |
| 0x1C | 28  | lock_difficulty               |     |
| 0x1D | 29  | position                      | yes |
| 0x1E | 30  | position_look                 | yes |
| 0x1F | 31  | look                          | yes |
| 0x20 | 32  | flying                        | yes |
| 0x21 | 33  | vehicle_move                  |     |
| 0x22 | 34  | steer_boat                    |     |
| 0x23 | 35  | pick_item_from_block          |     |
| 0x24 | 36  | pick_item_from_entity         |     |
| 0x25 | 37  | ping_request                  |     |
| 0x26 | 38  | craft_recipe_request          |     |
| 0x27 | 39  | abilities                     | yes |
| 0x28 | 40  | block_dig                     | yes |
| 0x29 | 41  | entity_action                 | yes |
| 0x2A | 42  | player_input                  |     |
| 0x2B | 43  | player_loaded                 | yes |
| 0x2C | 44  | pong                          |     |
| 0x2D | 45  | recipe_book                   |     |
| 0x2E | 46  | displayed_recipe              |     |
| 0x2F | 47  | name_item                     |     |
| 0x30 | 48  | resource_pack_receive         |     |
| 0x31 | 49  | advancement_tab               |     |
| 0x32 | 50  | select_trade                  |     |
| 0x33 | 51  | set_beacon_effect             |     |
| 0x34 | 52  | held_item_slot                | yes |
| 0x35 | 53  | update_command_block          |     |
| 0x36 | 54  | update_command_block_minecart |     |
| 0x37 | 55  | set_creative_slot             |     |
| 0x38 | 56  | update_jigsaw_block           |     |
| 0x39 | 57  | update_structure_block        |     |
| 0x3A | 58  | set_test_block                |     |
| 0x3B | 59  | update_sign                   |     |
| 0x3C | 60  | arm_animation                 | yes |
| 0x3D | 61  | spectate                      |     |
| 0x3E | 62  | test_instance_block_action    |     |
| 0x3F | 63  | block_place                   |     |
| 0x40 | 64  | use_item                      |     |
| 0x41 | 65  | custom_click_action           |     |
