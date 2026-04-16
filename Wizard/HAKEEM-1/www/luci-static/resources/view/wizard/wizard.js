'use strict';
'require view';
'require dom';
'require poll';
'require uci';
'require rpc';
'require form';

return view.extend({
	load: function() {
		return Promise.all([
			uci.changes(),
			uci.load('wireless'),
			uci.load('wizard')
		]);
	},

	render: function(data) {

		var m, s, o;
		var has_wifi = false;

		if (uci.sections('wireless', 'wifi-device').length > 0) {
			has_wifi = true;
		}

		m = new form.Map('wizard', [_('Router Setup')],
			_(' '));

		s = m.section(form.NamedSection, 'default', 'wizard');
		s.addremove = false;
		s.tab('wansetup', _('Wan Settings'), _('Three different ways to access the Internet, please choose according to your own situation.'));
		if (has_wifi) {
			s.tab('wifisetup', _('Wireless Settings'), _(' '));
			o = s.taboption("wifisetup", form.ListValue, 'set_Settings', _('Type'));
			o.rmempty = true;
			/*o.value('SETUPME', _('برمجة أكسس'));*/
			o.value('owifi_Vlan', _('برمجة أكسس'));
			o.value('sender_wds', _('WDS'));
			o.value('sender_mesh', _('MESH'));
			o = s.taboption("wifisetup", form.Value, "lan_ipaddr", _('IPv4 address'));
			o.datatype = 'ip4addr';
			o = s.taboption("wifisetup", form.Value, "lan_netmask", _('IPv4 netmask'));
			o.datatype = 'ip4addr';
			o.value('255.255.255.0');
			o.value('255.255.0.0');
			o.value('255.0.0.0');
			o.default = '255.255.255.0';
			o = s.taboption('wifisetup', form.Value, 'wifi_ssid', _('<abbr title=\"Extended Service Set Identifier\">إسم الشبكة</abbr>'));
			o.datatype = 'maxlength(32)';
			o.rmempty = true;
			o = s.taboption("wifisetup", form.ListValue, "key_type", _('ENCRYPTION : '));
			o.depends('set_Settings', 'SETUPME');
			o.rmempty = true;
			o.value('Noneme', _('NONE'));
			o.value('Passme', _('PASSWORD'));
			o.value('Hideme', _('HIDE'));
			o = s.taboption("wifisetup", form.Value, "normal_key", _("PASSWORD"));
			o.depends('key_type', 'Passme');
			o.datatype = 'wpakey';
			o.password = true;
			
			o = s.taboption("wifisetup", form.ListValue, "radio0_channel", _("قناة 2.4GHz"));
                           o.value("auto", _("تلقائي"));
                           for (let i = 1; i <= 11; i++) {
                           o.value(i, i);
                           }

                          o = s.taboption("wifisetup", form.ListValue, "radio1_channel", _("قناة 5GHz"));
                          o.value("auto", _("تلقائي"));
                          [36, 40, 44, 48, 52, 100, 112, 116, 132, 144, 149, 157, 161].forEach(ch => o.value(ch, ch));

			
			/* wds */
			o = s.taboption("wifisetup", form.ListValue, "wds_type", _('WDS TYPE :'));
			o.depends('set_Settings', 'sender_wds');
			o.rmempty = true;
			o.value('Sendvlan', _('مرسل'));
			o.value('Resndvlan', _('مستقبل'));
			o = s.taboption("wifisetup", form.Value, "ssid_wds_out", _('WDS ID :'));
			o.depends('wds_type', 'Sendvlan');
			o.datatype = 'maxlength(32)';
			o.placeholder = _('تخصيص عنوان نقطة الإرسال');
			o.rmempty = true;
			o = s.taboption("wifisetup", form.Value, "ssid_wds_in", _('WDS ID :'));
			o.depends('wds_type', 'Resndvlan');
			o.datatype = 'maxlength(32)';
			o.rmempty = true;
			o = s.taboption("wifisetup", form.ListValue, "wds_sender_hide_or", _('ENCRYPTION : '));
			o.depends('set_Settings', 'sender_wds');
			o.rmempty = true;
			o.value('hideSendvlan', _('HIDE'));
			o.value('passResndvlan', _('PASSWORD'));
			o = s.taboption("wifisetup", form.Value, "sender_key", _("PASSWORD"), _('كلمة المرور الخاصة بالنقطة.'));
			o.depends('wds_sender_hide_or', 'passResndvlan');
			o.datatype = 'wpakey';
			o.password = true;
			o = s.taboption("wifisetup", form.ListValue, "sender_Vlan", _('ADD VLAN'));
			o.depends('set_Settings', 'sender_wds');
			o.rmempty = true;
			o.value('Nvlan', _('WITHOUT VLAN'));
			o.value('Wvlan', _('WITH VLAN'));
			o = s.taboption("wifisetup", form.Value, "sender_wifi_Vlan", _('VLAN ID : '), _('لا يمكن ترك المربع بدون تحديد رقم فيلان'));
			o.depends('sender_Vlan', 'Wvlan');
			o.datatype = 'range(1, 4094)';
			o.rmempty = true;
			
			o = s.taboption("wifisetup", form.Value, "Mesh_wifi_ssid", _('MESH ID : '));
			o.depends('set_Settings', 'sender_mesh');
			o.datatype = 'maxlength(32)';
			o.rmempty = true;
			
			o = s.taboption("wifisetup", form.ListValue, "mesh_sender_hide_or", _('ENCRYPTION : '));
			o.depends('set_Settings', 'sender_mesh');
			o.rmempty = true;
			o.value('hideSendmesh', _('NONE'));
			o.value('passResndmesh', _('PASSWORD'));
			o = s.taboption("wifisetup", form.Value, "mesh_key", _("PASSWORD"), _('كلمة المرور الخاصة بالنقطة.'));
			o.depends('mesh_sender_hide_or', 'passResndmesh');
			o.datatype = 'sae';
			o.password = true;
			
			o = s.taboption("wifisetup", form.ListValue, "mesh_Vlan", _('ADD VLAN'));
			o.depends('set_Settings', 'sender_mesh');
			o.rmempty = true;
			o.value('mNvlan', _('WITHOUT VLAN'));
			o.value('mWvlan', _('WITH VLAN'));
			o = s.taboption("wifisetup", form.Value, "mesh_wifi_Vlan", _('VLAN ID : '), _('لا يمكن ترك المربع بدون تحديد رقم فيلان'));
			o.depends('mesh_Vlan', 'mWvlan');
			o.datatype = 'range(1, 4094)';
			o.rmempty = true;
			
			
			/* vlan */
			o = s.taboption("wifisetup", form.Flag, "wifi_flag_Vlan", _('إضافة فيلان'));
			o.depends('set_Settings', 'owifi_Vlan');
			o.rmempty = true;
			o = s.taboption("wifisetup", form.Value, "wifi_Vlan", _('VLAN ID : '));
			o.depends('wifi_flag_Vlan', '1');
			o.datatype = 'range(1, 4094)';
			o.rmempty = true;
			o = s.taboption("wifisetup", form.Flag, "wifi_key_nVlan", _('حماية بكلمة مرور'));
			o.rmempty = true;
			o = s.taboption("wifisetup", form.Value, "wifi_key", _("PASSWORD"));
			o.depends('wifi_key_nVlan', '1');
			o.datatype = 'wpakey';
			o.password = true;
			o = s.taboption("wifisetup", form.Flag, "Vlan_normal_pass", _('HIDE'));
			o.depends('owifi_Vlan', '1');
			o.rmempty = true;
			o = s.taboption("wifisetup", form.Value, "Vlan_normal_key", _("PASSWORD"));
			o.depends('Vlan_normal_pass', '1');
			o.datatype = 'wpakey';
			o.password = true;
			

			
		}

		/*if (has_wifi) {
			o = s.taboption('wifisetup', form.Value, 'wifi_ssidd', _('<abbr title=\"Extended Service Set Identifier\">ESSID</abbr>'));
			o.datatype = 'maxlength(32)';

			o = s.taboption("wifisetup", form.Value, "wifi_keyy", _("Key"));
			o.datatype = 'wpakey';
			o.password = true;
		}*/

		s.tab('lansetup', _('More Settings'));
		
		o = s.taboption("lansetup", form.Flag, "n_reset", _('حماية من السرقة'), _('تفعيل / تعطيل الزر الخاص بالفورمات'));
		o.depends('min_reboot', '0');
		o.default = '0';
		o.rmempty = true;
		o = s.taboption("lansetup", form.Flag, "min_reboot", _('فورمات بوقت'));
		o.default = '0';
		o.rmempty = true;
		o = s.taboption("lansetup", form.Value, "reset_timer", _('عمل فورمات بعد مرور    *بالثانية : '));
		o.depends('min_reboot', '1');
		o.default = '20';
		o.placeholder = _('.ضبط طول المدة الزمنية لزر الفورمات');
		o.datatype = 'range(5, 1000)';
		o.rmempty = true;
		
		o = s.taboption("lansetup", form.Flag, "watchcat_timer_on", _('واتش كات'), _('ضبط مؤقت تلقائي لـ إيقاف وإعادة تشغيل الجهاز'));
		o.default = '0';
		o.rmempty = true;
		o = s.taboption("lansetup", form.Value, "watchcat_timer", _('إعادة تشغيل الجهاز بعد مرور    *بالساعة : '));
		o.depends('watchcat_timer_on', '1');
		o.default = '6';
		o.placeholder = _('.حدد مقدار الوقت المقدر ﻹعادة تشغيل الجهاز التلقائي دورياً');
		o.datatype = 'range(1, 24)';
		o.rmempty = true;
		
		o = s.taboption("lansetup", form.Flag, "clean_wifi", _('تحسين الإشارة'), _('تحسين جودة الإشارة والحد من التشويش'));
		o.default = '0';
		o.rmempty = true;
		
		
		o = s.taboption("lansetup", form.Value, "root_password", _('كلمة مرور الراوتر (Root)'));
		o.password = true;
		o.rmempty = true;
		o.datatype = 'minlength(4)';
		o.placeholder = _('أدخل كلمة مرور الراوتر الجديدة');
		
		/*btn = s:taboption("lansetup", Button, "_btn", translate("Run my script"));

		function btn.write();
		luci.sys.call("logger button pressed ");
		end;*/
		
		
		/*o = s.taboption('lansetup', form.Value, 'lan_ipaddr', _('IPv4 address'));
		o.datatype = 'ip4addr';

		o = s.taboption('lansetup', form.Value, 'lan_netmask', _('IPv4 netmask'));
		o.datatype = 'ip4addr';
		o.value('255.255.255.0');
		o.value('255.255.0.0');
		o.value('255.0.0.0');*/

		return m.render();
	}
	
	/*handleSaveApply: null,
	handleSave: null,
	handleReset: null*/
});
