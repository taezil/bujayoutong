INSERT OR IGNORE INTO app_settings(key,value) VALUES('catalog_import_started_v2','1');
DELETE FROM pack_options WHERE product_id IN ('ERP-31138','ERP-30203','ERP-4008','ERP-30903','ERP-31106','ERP-32161');
INSERT OR REPLACE INTO products (id,name,category,sub,unit,price,soldout,photo,sort_order,tax_type,warehouse_zone,description,servings_per_unit,box_contents,servings_per_box,storage_method,price_list_visible,price_display_mode,hidden,promo_price) VALUES
('ERP-31138','할라피뇨피클(오뚜기)','신선식품','반찬·절임','2.8kg',10500,0,'',900,'taxable','','','','','','',1,'fixed',0,NULL),
('ERP-30203','깐 메추리알(행사)','행사품목','이번 주 행사','10kg',58000,0,'',901,'exempt','','','','10','','',1,'fixed',0,NULL),
('ERP-4008','다시멸치','행사품목','이번 주 행사','1.5kg',11000,0,'',902,'exempt','','','','','','',1,'fixed',0,NULL),
('ERP-30903','떡갈비(행사)','행사품목','이번 주 행사','10kg',45000,0,'',903,'taxable','','1봉 30개정도','','5','','',1,'fixed',0,NULL),
('ERP-31106','생김치/행사(중국산)','행사품목','이번 주 행사','10kg',14500,0,'',904,'exempt','','','','','','',1,'fixed',0,NULL),
('ERP-32161','조각정육행사용/수입','행사품목','이번 주 행사','5kg',32000,0,'',905,'exempt','','','','4','','',1,'fixed',0,NULL);
INSERT INTO pack_options (product_id,label,spec,price,step,sort_order) VALUES
('ERP-31138','캔','2.8kg',10500,1,0),
('ERP-30203','박스','10kg',58000,1,0),
('ERP-4008','박스','1.5kg',11000,1,0),
('ERP-30903','박스','10kg',45000,1,0),
('ERP-31106','박스','10kg',14500,1,0),
('ERP-32161','봉지','5kg',32000,1,0);