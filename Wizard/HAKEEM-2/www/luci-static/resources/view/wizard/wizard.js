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

		m = new form.Map('wizard', [_('الإعدادات السريعة')],
			_(''));

		s = m.section(form.NamedSection, 'default', 'wizard');
		s.addremove = false;
		// start tab 
	
		if (has_wifi) {
			s.tab('wifisetup', _('واي فاي'), _(''));
		}
		s.tab('lansetup', _('ip و vlan'));
		//end tab
		//start wan
		
		//end wan 
		//start wifi
		if (has_wifi) {
			o = s.taboption('wifisetup', form.Value, 'wifi_ssid', _('<abbr title=\"Extended Service Set Identifier\">اسم الشبكة</abbr>'));
			o.datatype = 'maxlength(32)';

			o = s.taboption("wifisetup", form.Value, "wifi_key", _("كلمة المرور (اتركها فارغة إذا كنت تريد بدون كلمة مرور)"));
			o.datatype = 'wpakey';
			o.password = true;
			
			
	
	o = s.taboption("wifisetup", form.ListValue, "wifi_mode", _("إذا كنت تريد MESH أو WDS"));
	o.value("", _("None"));
	o.value("wds_tx", _("WDS مرسل"));
	o.value("wds_rx", _("WDS مستقبل"));
	o.value("mesh_tx", _("Mesh مرسل"));
	o.value("mesh_rx", _("Mesh مستقبل"));
	o.default = "";

	// ---- Mesh Settings ----

	

	
	}
	o = s.taboption("wifisetup", form.Value, "special_ssid", _("اسم البث"));
	o.depends({ wifi_mode: "mesh_tx" });
	o.depends({ wifi_mode: "mesh_rx" });
	o.depends({ wifi_mode: "wds_tx" });
	o.depends({ wifi_mode: "wds_rx" });
	
	o = s.taboption("wifisetup", form.Value, "special_key", _("كلمة المرور (اتركها فارغة إذا كنت تريد بدون كلمة مرور)"));
	o.datatype = 'wpakey';
	o.password = true;
	o.depends({ wifi_mode: "mesh_tx" });
	o.depends({ wifi_mode: "mesh_rx" });
	o.depends({ wifi_mode: "wds_tx" });
	o.depends({ wifi_mode: "wds_rx" });
		//end wifi
		//start lan
		o = s.taboption('lansetup', form.Value, 'lan_ipaddr', _('IP'));
		o.datatype = 'ip4addr';

		o = s.taboption('lansetup', form.Value, 'lan_netmask', _('netmask'));
		o.datatype = 'ip4addr';
		o.value('255.255.255.0');
		o.value('255.255.0.0');
		o.value('255.0.0.0');
		
		//o.depends('set_Settings', 'owifi_Vlan');
		o = s.taboption("lansetup", form.Flag, "isVlan", _('إضافة فيلان'));
		o.rmempty = true;
		o.default = false;
		
		o = s.taboption("lansetup", form.Value, "vlan_id", _('ID'));
		o.depends('isVlan', '1');
		o.datatype = 'range(1, 4094)';
		o.rmempty = true;
		//end lan

		return m.render();
	}
});
