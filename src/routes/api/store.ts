import { createFileRoute } from "@tanstack/react-router";
import { getCustomer, isAdmin } from "../../lib/auth.server";
import { db, ensureDatabase, readStore } from "../../lib/db.server";
import { bindings } from "../../lib/bindings.server";
import { CATALOG_SQL_CHUNKS } from "../../catalog-sql.generated";
import { SAFE_CATALOG_PHOTOS } from "../../catalog-photo-safe.generated";



type PhotoImportEntry = { key: string; sourceUrl: string; productIds: string[] };

const PHOTO_IMPORT_GZIP_BASE64 = "H4sIAC0D3moC/8V9a3MbR5blf3GE/GmKlTefNztC4XD3uN3udfd42juxj4kJRD5JmCRAEaAlamP/+54ESVTKXSjqZa0tSoUiCFZm3cc591X/+X++uiz3X/3hqxT24Wp7PgjNyftI0odKbASnUs5el3jz1b98tdve3abyH7dXeP/Ffn+z+8M47vZhv05n1+U8XIfb/VnaXo83t9t8l/bj+jqcl5GUd4e/JAl1PFjRyltx9svNOT748Qd+yLuv/vCfX333j58GJQzzV//1f//lt9cXddBKJXJZumpCoerU0vWlvDlbX+MNuMTx7uZqG/L4sxRSCSvYpRK9ZxWS13EsTFRUKB4n9dnN5uSVOT93ZSZaJpU5Cq7KWyeyl0tXtr+4u46bsL7Cnt3dhM15u9S2fcdv7Mbbcr3dl1F7+QZf5c3jlt6WPb798GI3OqxAGSG0EI5Z8WC8KoaCHnzKPOhIeYiR/FBDipWitEqV0ztPgg2+87hWEsdjKenpmKT2x/OC1dx+FHxQ0lTJU0wsIxdavFPXZxchh+vrcHV12Aa89ShJcX0+Hm4ajz6JXLzQKnhjHSUjcrA6QF5TUMnk0wuTys5eaPS5UjClOBtlydnYkpYvdFfWm93dLmzOLm/nr9OMWRiIp2cPCStUgtIKexF9UpJKjvK0gJGXfNxoNvbpWLKR03k7K4ROFilqqdnpbFPOQgexqB7bzb5s9md1u827m9v15hx731b1a9nk7e1IjulJzjyJlTbGeO0ci9Xt6RVIP6+8lFiXmoSTzheTos4pfwaRiC65EFlLDwnPOZCKsTiuOWQuMckFK6OsmdVl501VJUhLwubKQdXFbTxv+7dZb0o4292Uks9DXIfDJT99Y7xa7/bjDnqqpVvRwiWRFHOXVGMwNYXgYlVRkUva6i9iXtomj0KO2Gji0YyBvM/R0eBtVIPWMDE+izLopHxuWy45Ly3P66NAW/t0DPN1NDqyGdiHY4Y7Op5W2k72Bzbn6TxZmtsw6WADXc0p+mgSVE+4RU92WO5vN2tuQxRpw449ZEMKKwedo66B3VBKDM3cxoGtFoMw0TTbkrWSS1aJjyaW7LxryanaZBVno7LWRUcbxRe598QEcfVwA8qSMwNLgYuwWCr5OmhI5NBkYVBQZCskJED6Bc/iVWfMxLx/r1pGEULzwTHL7B10atFENA3LtyVcnzDGWtAYa4KtqbF5SSOjjBr+H8IaNMP3W7cgr/iAuesUQhC7YrwjlURKKpj4Zby91oqlhc83VuoBbt4IXMXgJSXckaoGWAc5VC0cWc0K17i0On+8IwJLmVupMiZ7WB/tik3JilyFXtaj87McNuF1OILBFc6N2Hv8NxpyIxR/PJzCAV4/mMNvVr++xO2CUklNZCzZUxZk3rkEA00SBQqiVZZVJs/PuPF0Uep12Dx6vFnRsbhW6LjzEfBARgXXpiCZ2HktdeJg9MLmSp7V5pLgXXSxHIpOqfiqtf2dROfBi6/WGxzst7f3Y7FZjRB8xUHImo22MVX4TtI+KCsCFlirtAFIltlwUSpXq12NReQk4XNOLxfrnfWlLokqq43aWEsKaE0sw6vPudwcrRyTiwkINPjsXGFZTHE5cbFG1gKiA1Pmgcykhd8hICcjIT26CBXgZBcwDkRg1u0Elo61x3YZ2JagScllMdxflPvt3eaAIU7DHD1KIBtItdSyxNx8bayObbPEwGQuLPoYJScY756croQNO57W6snpgkccnSsZksfTx0Ms3k4faM3TB3owkLk9SdjmapTLFrykJLxNuUVSqc7CzbDZ3mJrwm4/yDOQy7db2JTdYYPOb0s+ItRmUB5tozYrmDQYEI+LAkBdogJHFEIwgsdjrKbjOO64RpZqHidmyVAWCWMrJDAnzPGXccxCE3tSyvvmmz24XhExV2VB9QJcswoK9A8oLToVIUBJFq0WbJUzs8obcpUxGohyliJUnUMpn2D8wVNHKcXB+Fsc4PUSFpbKzepYM5q+KFet8gSvZELIv9e271av7rYtyLHdrMLNerwKu6x/vU8j6EbxGgQPJlTbTMFLmVOw3pTcnMXCZuuJYZOflK15vun8kewxmXnhUwFWnAUMDKilcmBA7ksZVmOzGStshnFVMWCiKd6lCLYGwmoos806kYW0WJulz6raYJyxiW2VSi4aK543rEaz5ygteB2oNVy9XV7ubr0voOq74zKFH60ejRnbN6BBoBwaYg+o7ldrWjkjFi9qVj9gI+A6a8mJTLUmaNz7pYt6/fr12S/r++32CXU8/q7Vwz5f399tduEW92a8D+kilEucvyqr/d0aRyu6PF9UF5oPcABMyxBVpCJrJFcIvvgTabchggzAoOsio82WRXbeVe0EcIJKwWm5EOFomHzuQq1rKk+CCMLkKbAq/nnKdh1yGdabIV2sNw9mR1bxixD3392li5+v/hZvz7fjn2+3b8tm+LmE5maHn1/drfPwp3DVopbDT1Dw4eftfrs5H/6x3pzvhtfr/cXw4/b18NPtOh3v6Jwueycmv6knXzmx3O6YgN0nj2tFp+1u+tHJBfnJTUnnOqNhJyJlzXTeeje5L/tkWOAspoie09NvVVNET06/1k8O0QuaDUaI4smJYEFxPUgv/I/5XRw6kVgpg2vW3gpe8uiiefTZK4VRTplcVIkKGye5vkc8G7oX7++uLjo/hl+4e7qu2/D6oAUwKS+++9OLP/oXntvBt/YF4+CPL7x68UdqZ/iPL77906rAeMFNiaHCVg46468YBPiac6lyKamSXVAX4+ys8UkegiCqg+qVlFkmQZ8lwtFo2Chc+0M8qjEkl5wMaXCS/KABOQfQhTCUWpMycDuW0lJAGehzzqBLlX0hfDjoLECLFV5/aKoh7Pewk+9a0V17uSr56RXDRcKZjT/87fsVlE6d/fWn709stJ3faIKDjR66XlPQ2O8A6LXoaevuDKcvttfl0czjTF1flfF7GJ8fHsHqgel6XgwGCjO7ddqB2BTn4f4BDlysIiy6nfPcgNk5tu2y7B8vqf0gGVyBx86ur65G2K9TGY95jxxdFJUjzH6uOZaQklnOFV1sbyTg4d11E75N2T8gj/EfQIdv8DV+Uzfhurxs73+hvn0h/4w///RDj+cutq9xdIOvb40E4ifcu0Ok44X6893+hfrXg5cS+AbQgjSnHBHNOiJgeQ+8Ygkk3YtGXcrHxg7/CToBwojRp3brI+gQ68q1siPAGm6cOzUKSpp1ALHipArBb4O7RqOy9dK7hdSUmheXCogTKWRfq+YQIcVsnkPxbY9v4As3+yMOOG9JgtErD/AEQ4CD1cWS7M4rU6VsHKu2WlByA7v4uwWy/zn8wQY8WjtseM1ZKF2rLMGooquA7xQimJxB/lO0ADdBZ3jj4mKhFuN1eimVACs3G+1JpDgFAxMUUrZSeNCEz5JKaCIvllMJcJpzl8RFh9hyJaDlTuhUXc2f45Jg54VYXaRG9cyyWZvSio3JThinC+vDPXSwyU+BY+Iu9Wi749mwIBykELjLtrBkGSvV+mG0wauW+mA/0QaQbvaCvWq0Adx/KY0t5k1nLSBvwHG5OKh+AaORcRmSQwl362vgks0pTK6FHltgC3coJBF9tEmC/SthC8A/uxS8XZJfms89REMK4g/51grQDDDAPxsBAJB+vd0cDUd+3Q4fHfjqdrvddx77fLwO680oWi5O6ad/nV3pVTjEhevL9uu+fvWSxSlyZmateGUlJcPSEvhxrD7Z8lytwPDLehNvz+L67cV2t29usrnt3aPpO8QIR1pJZVfknLUAvhYvl3bVu/mgKDB8UBnkWUrKRennKNmbzTB4FvFu/9a8eXu3jq/iiah142b4bOAy7ZNX2Tn4Z/DvGKD1IO7BubB0xbbjEGbWhPsCP8TAa4Gclwq7a+rnYb2Adr8A3e1Xu7tfSlwfGC8s9MIW84kdBlAjjzXDi4P1QjtcSp8QuZLsRqjqIXKlcYDXfdqCLEkJuCC1nk9bML43e5mcPCvoWGJ4H3gY4s+V2nvVbNZ8EMu/UVf7X3k7+qiYlSnBA3IE4hjhDGpOBSLjTeKFYIPp7fBEZXF+Kg2xalZ+HAP6FuUdRecBE4jqYpIv7HaArdfD+e5JeA52WHqtWY00GiNOZu9oPiJiKbNr3p1i0JAVWZ+rIgq7y7u269iSgxQ8aZ36kcbv/psyxsoVjhd8gVXztkDICIcCAZUFpgBuPYcvldkX2MgDzcMfCEMRsYYCelHtoHEdg8/eDjlkGUTO0Yu0GCKbdcAwPwYkD/sNHxdJ18j8eYzF9foq57vL1S7s7jbPBseEm919cHGHLfIlQxqDJJM0f5HdP+QSvXNkjXU8BHCNYo0fqtJh0CqlwRvDQwZ9VQZIFMZsURtnV6dsBTfDNwXInqwtQ/opVhBGboSDOcg/PhO/Vcp3srdSwPuQlkqf1EgzCzOEKjI7YyM1RaJqa1z01Vme17fu9eV6fX55/etZutre5Xq73ewPvPJmnS6BKSSEWo7f//tP//aX/f7f//sP5Qe213//G1//sjstJbNmumCHtRFBRJspSQZZWMRrLaB19lzU6zHgxXZKYPGKgCmcYnKLaft5VUsJ0hZxkUoGp2yRMtdPqf5S1snjpckVMAr8PQC1fIjEPSGz3Ut29g2+vt6/XG9261xObu6JAjxtAYRJKpG1UVxDlc9l7tdXlyE+AsxTOAh4OBivYFdtbukIYVv0O7RaDfwyFhyW/JuXU+mj5fkwTBYFegnTIaq1QBoNYX8hKhuzDaMwqRYnM0ublAUci1LG0pQMnhUipJyUJoRWgJix/bAvHF2QTmq7VKdD8liAReSOtVhu2hCljoFpwKwpugyPPNVlOZo+RUyHUxYZ1uN4etptAryaUl+z9EmbWmKtMYMpKNjNJDI9579bQGNd7w/7vXuE9QT352h0muUU421xQqX5sEHf/PqyFWUBSwuvvn69zvuLl5CjExhP6Fkj7GHlKyAWbhQou03W5fyh0TrZIuAgc15O0bpvfi23uDzjjFCkzIlrmgcdFRKrOKnqq5Up67bTnyvChY/UY0k+16A5FaqQTq7Yw5Bdtt544uSAPCtLQE3QMrg8aunLTJ4aU1sM8/sT1ZEWuih8DqDmSRTQ3ffwc3e367P1dnz6lIf1QHFA+uHoiEdXalNyGCSZAYgSZ28ivooPLHKxneuzAm9o5UtKfb27gDG9fKmseKG+VfaUL9TzkIRFcdAq3wgB6IBStdbn7OF2fb59u745ERvAp/DoySfHABXRxVYiJZyOFTeoBUh1WrKFggR3ZWKqS1tNuSo6VnDqE1kjF2ETYEq905Z95owP+6TiZFbceU4pWpEicI79SPeknZwqY8Rk4MyUeYPn567w1HTvN13N9lRWI4+pfj/lAXHYx7Cm07LfzlnqlI3xYE5G6uw9SGfEFX3SHvqjh/e8guWFVdDSfuQWdrnLVgo0LXE6nMghdcVHZnoHTfUQU+JUqK5QUfgpGuhM16ygprrhqeBJcufC1CS7rsuVTndSi/m61JZChOpkgjJmAdkNz6SAPmuxhREjbKfVkZRMcN8iQaNLyqZWuIVm70RpB8Yqk/AFSAmzZXQo0Ll8ury1ye0sJKsN0SQqDYp6VwqQzaKqvt5uwcHO97chP4jYiaoBOUJ0PSfwQJh8HUH9PVd12NWkKye/xHHULJmPxansKhhShVGRkBTWH5aGeswnjTfj/4SxdsCMUPkD/v5me7N/+ZSfOnvlxdf7+5vy8nATv77bP9l9Q5q8OFmweky/w0ZSh5UmGfXzhU6GOQtXTElKWq2qiE5+bIb3tzGgi7fr17fX5e3IkWT2GuhQFh0qMxCjw1aSTAE4aylmbIToOlImDVV6vkUq4+MDkIxy0fhwKCt+7k7pj0kY6sWE4Y9gpwAazrZk2rsZQwurBPsi3QHfzuZCO6NEXaeUVfP1Bza5FCOEsmXzVAI51su+fJvvo4ynaQ0A9AiWFGAHHNXWXgVQwi4QkHD1PjJY1BKAkpPx1G4+YqOLatQvBhVUMUZk88UqdnUVNMKSaayPKVXIoGWg59ZLZlTSRSsu3qv2HZdIF6mcB3/kYEMhw01ry2kY0zVQzRd0ZcMhSBj3wiZnYFIQjOdEVH2MiKpFEf1fEhYcoqK1kP8korKxCLAxP7tMOtGxAOcVhIzG2kA1SIZjVJ+CHKRupXSP6EuvnLHAmVAruVh4y5348eSkQV+mLKCeQMI7MKKjjrC34mhT7ZQ01FPrXIuSzHLHVJxPoD6WI2dpBMtld3GT74d6Vd6cDxfh7HAQ9k91HRkf+pgcav7vfLs5b35u3B0SXk0U5PhgViDN1IrGCT7arUxroZOt6Jq9JGNWYEUKJuR00Ic6YCQhFrPRPhAqqbJKORdglGhEjb9HWZZsYSoswRLzYnfdfGrGC64arlrr4KOU3rpYPxOGJbOCmVAensnRkiCSn8/HuGCAI2txyRDYkSPl9Kddm1JHLfErZbXxVmte1hLvJpYhzYQepJvK/qZIi/BTGlw6nhSJ/IR8j9Ljpzp+Eq4rPlZTvaDrKvqnj/ZdZtB7P1+Y1Air9gVKnAS+bLXPlZre3NzvAB+XG3H0mGNqjqB4DWQKhAvkKG3FXSo5OmvsUhn5/MW2ZgRLkUMrnI2eVV2uojq6M/fJ5fvOwlIKL7BfLZM6VMExMJUhAX0MWrUKOxfq4FknnV1u2fsF0zCf5ZLcOmMbQPAF3K21tKrn0WOrWru5ujuk2m73eVQu+EpCDey0gvXUdQjWq8EbmC4JW5RU/ub1S3ciB0fCTTC3tZbPsY1KSpQSIoXig8tB0fs39R/3/pFhqJasTQa4K0iRbTxZLkXCdA0txwJcnJ4U4dja0oIkswJfU1ElCm8sFhcz7lP4/1MDh412gDX+n2vgqEWRWt7lRJva0arYri6npbOn1lvbcfWuSUF1xcSuOy+689J3Ad95RbRVeRUKixSB+ah6GcyX6ufIr17dhJuyHVthUSoygvXaVhcWDceaOLeWbQWrutTPYTszOgGW1os04c1jcML2jVTOdg1Hphuw0Mmmmg+CywQ1hG2TXCUIv/RefpmuYGvkIUrkNQTAqCGL5JzIdUgA6NAIK4YQKA85QrEDF1jrpRKZVkgwm3JTqvgEcAAnQkoZb9TvtDwYULMK1+vb1eOPrrZpv2JxCfcN1BN1dC44KgkMGcQhMNhGPfBxKFiWBKNFpajqQhRgXy4AnsfWD53NQt3KfLukDzpEWBI22DoYV0jhogd9/OSH2PXZ5d3t1UOK4yKvr9uCd+u3ZXyhvoMZEG/GV3fhar2/H70Yd7fpt5NatHQZdmxoMwgGCLUdQoTNj5Ul/FBuaZaT67F930IXz+uaD/CWCY+Y2ZvO7CDulXODiK2RKGT7ZWohcoYMezu0FjfAmFKHGHIeCK8t1RbDNNYzCys1A9NZDQ/OC7W44KLTfoiu7cPPtxJyG2QSoElZKFxCSgBRn6eYHxBDaGaoD4FUDlZmlSv7Af62FfM7O8CEiKG09bN2qtJSoYE+5uxM3+SinJtO03Q4X/RUCSi0xkCwr4BeBc71PUD27uxqu9+X7eNa9+X6Yb2HXK+TUnjthRp//G4kCSYwupbeg10fVzRKPxKN2ra/Bd5CYF0OEKxRGQkspm3rNTlt5N2UEHB95NqafhCFO76l6yM11J2eDzoop0zUXAygsxTRg6J+ruqC1sj9JAqssFgtWpbKnG4G5Wkdrae7oxBTn6zsuhZ9tx1yAntN6o5pXDElervmYj8FA4js9G49ZYvfiZHOsknSLmQioNTG3RwogfpMHT7hNl2sfy0P/deW9Bjvri5HDd/sjHv6dyVO2gDfk65jYMIL2efOJ5ePOzULjgO8Ty41eZfbCAZrvP8wFA8Q79gaIOw0OJ3NoKM0Q7RZANaGEIH0gtXxZFZsNhEFVFQkVQEG1oaEQXzD4raH692+3L5eb8phv1eb8ubR73zz6iWbr+G4DqB3d0S9v0naN8yLr0PiHv8SviDJCv+wpvaKHPsGhx/vZHv/9pe7ATf6er27uxq2t+vz9SZcDcqZ66uWrceew8uLN4+Q+VcgZnIQUEgR269fv6SHGpA56255vurUcbUETGZUqsYq5aP52Dx0a7QAwB4hRaMD7A4lq5AE6zYVx9gaTc4WNyBSpnfz0KKNWNMHBDlfLt3VdNjpsKv7JTOd9l3QTR1P+6m4w0yHusuCqqlcBA5zFveTyVGV5EuWmUsB47XPija9ZxVCAmofTRUFtj3Umi1QGhRIaZm1EKnFlUHZMpwGTEtMMRTptG6zMWRs9m0psAXsd9wI2bVodtOK/HTc5rBMuOf4k6SmfVOTxeugk+2DL/74GdRlWhzNp4ljbrXn1UMEk+JQzHLVfss4rOFkb6+vSnp7dnM1vg27bbzH5t7Aw4xyhEQru4KLNF4esibf3ABclv3Lt/mXktbl+6vt601ZXW8jFPQE4u35jZ4Ez8/Hqwlomw+pPWm1aKFd9Qmli97wCIL8WMDtFF7PzJ2RuCn+Pcs3ZN+6391imsoFhHaTInXJfWN6Dj29RXdl1D3ldrrLZk+TN4Ts1K1LkKuueMF2LTV8LDXApnfdxF0mnKdjqXgqA5vi6kKp6S3dfC4x5dyxBdPd7Qq7gJmnTHxnVth1Tn76nXbSj2PpGU/tQnhDB0imsWKqH2vSrVPA7s9XTeIuac0wqK38NJWi329wo/9w0vEu4XqwWYe+otZC0PqMpB5b2AC+CZQLIDY4x0EMsrIbYPXL4EuRQ8le2JoiLMFSXELO5ySZWx8rFhrYZoMtr8vNRx+SCTJ+pXGbnfTKyocZgR9aRIJFzdo0a2IsPsOah1Rgz1X2/LmyG2aK0is6GLmWsVFuqRyB5yvrwGdSruSUtMkJhxsonx2Zkn7BNR7r/a6fLuXQMvwkMjBND6FwKWE0SDX7bpeSL5PzgBGYHFA3UsB3Ib4JoLYE3FSAOT+RLroqYggqgFjCsLUGSfEpQ8E02JrRD3XlTRvx/2+sswPMaGUW9j2tM9FxRBFPATfua4okd/mMroNlSrPg7fNjP7iCKLs2c4cAfQk6ueibKuTvRLHyQ6bwcZhAICAg422b4KoCiVhCVaxFrrkWWcNCNGlKbQvTLZd7XzQZUTsNe6Ju8sRkzI3syFs3B2mK4NBUSyWc6ASpHyrlqBs80QEl7hya7rLAHTWyXsxPJIre1Fja3ItUQWuUc5+rcFUCBo4R6B1+gGIVycjUSlVVjDbVlnfH1UKfoyOgEpCmCB0KlMiVQs19LBVadbWF7nh4jLfLaeiW7EvgppxbP0dEmPlpF4WtA7oFSZQ5VeBRFemTLLty9hhH8qvD1MGW83WLw418V7U3S2mlhPEQrbDEkg/aZ6/Lx1Zs/aiavkAMwALfv2KrzU2QTsgTyjQPqkNSLSOUi2QLD2StWU5TfMrUEzhBLeGF2JwMLwCUmQmf6S7eJDoF7FR6vsHXNBGOoioJ1pcdqWjp+YmbaSld20awKbBZEGyToUCgXUEG6aJ02QJy4E81Sw0IRk5hH93NR9Wui7ZNSyPzzvGECm1XretN5wNVF5oVndGbNTm56jZCrU2v8yqE1mGxiJe2++3letjVw00um4cikXd8eZvLCYVPrXIQlsNXo4LRok1JhFzlsPrf//Hm7tt//ADC5UwpHs7BENCPbexVtHdZGUMysUSA9GJyWYrmzdtRyoJwe+BfCjatRYHKJ/UKtVBFV4wN/uu0Bbb/KBAIfjIbOcZdrFbICK4RQoE/qsuTLPJlu953Jlk9DoH/+9+/y+t9s3EtuueEHUPmrFPWMbjIwbcKl6KTS8E6y3EBCvLU6QIX1oEKPd/rFiN8YSqcW4VJ4+mxfFqblpbUleZY6SQxXJX8qBJuaboAbVfVrnQHCmeRb2mNUK2NVcU2lA4cW3ySSPU20dkVa9/KXuxHFqfz5GFdj1GmWJcTXZuSmopk+hqYqe6s8cxZGRWUHBAhFq8yzJ+nksLzCCXgatfHntcpuaHzIY+hceBaZ2VJdilJ0fVeiy6mNHu/hG82xCpZuIXGoqzui01iAd1Wo9MFdi0I5wCgQpvKUrg4w4UI14KjNlKuTU1pjQ4wwkDDRpnU5jgsDQTgCf72gRA9f7fgSJIIQJQw66CXORtedn/nr9vSL+5ODeKA1sjRqQw3Exo+9Mq3IZy2oSehS05C5KVinhMdCKGEpBUMHpwRvFb1FMwnaVeXGFJmJQlUD6zXuY9s/eAua0R6QrAtDzpHk1PrC1M2JICPVlBAPn8uYwGoyq1GEgZYLz1oQXfRK2unkJVxXaUldR0j3du7mFk/mN53rNvMlz9mb0tW2cG1KB25TUysHzSRRtPIctRumkjTinIclkzPDbJkMfXLSD9fgRBrrCrXCj8oUwD4qFV8LobVRh2MMhGkJeagZdXwrAX+lsDmcooxA/2A6CfBKbUJvD4bWFPmlvZiVeRiC/xE4f1Eh2VXsS+lnwDkVOXYsvuzFXTJk4nVEOVmikqNTvDHEpV/bVO94ErkQ+vte/AUgD7h29D8Q//U/Cj0+YGfOnAAmI2RgCn1YXM/3gMpHplGJ3EAzy9VzQsxR7Kqy+N21vfEZD0Aa9Ues+Gzzlr7yFyWre/6avtrOb9YGkwKpA7yLuDSarCQBJWEy/Am1bpUIE1LQTPVE48OJKjJOoiub6yLtIjuHV3QZRI4ofqH6VDfitANC51C+rJLLRF3YXSaL/AnB18elAE3a0kFy94/M1Po/u4ibJqEntxNeDLVunhrgpQqNsEb7KUQNWaZZJsxuiQL3AXSpgoYeeKBQcze+iAIRKglaJrQPvPoh4vLx0GQJ3moG0sutjgBc5Z0VCHnUGUuYKXBsghiyVROzzjCSvR8AlNCYGMrFhSZLHw8LSpaDJdwXNfbkzO8rKCxGB1ar5+VOnOMKbYqEwCkJsFChoUnDpDsZ8fOh6cFYCQrYC5gaRGwJTCsi2R202K32026UO/OYznMj9GHMaFyBAPyzI6tWn37l7/+9Wf3F/7+f/DiwxHmaSm4WGrTGkTSPrj2CBWVPng0EKiKNMbbpdFAxPMkxqaQo4TkU23c22pDzzyjKF2VsFmfX21juPqtIJY3+9swaROPtRagrGy9j2CxFiQzgYDnqBUwsAy0II7uxCgEiIS1quWFtM+laPHseJ203e1xLx9u53XJ67Abd/e71XVoNRpPKOrCxPGimlFZxmaR0waOebGS0/YNPV3oxXXJRue7KGY3RcJ0QIt1P3qjKyucJvLjM/v0RpfA7J9S0B3jp+dHUdWaswuuQMVa0hVg/cPAmBxZj4q6qeLSHWy6fHaqODbJToRzfhZAUTZrXKMRrWWgVF42is+HaegYppF61fqqW4evas0yp+bi8omhOIlN6+QvVLUJ7FSxyz3Rs7rqjQdR1GJBV8Ho5ptNAA+VLqZNVialqgVF/JQKAUAHQKWHhxPgAK/fGfEGyWpFtMq874AH7p6uQ10YU1DHNeYj5G20J0MusTHZa9De8Fzj7+LSuBU+6se5TdTKc7V9J7/WGIQk04Kk77k2SPpstZq1jaSzKCo5aFYbcftJGQjQ6amSdQXsYwEQFKsHef3wsOJ8RC6YgruSGxBVSZv2iMEvNsgnRTHm5LICp1SxZJGr5TZt1omoXAiAsmCJ7VlTNpDO+IZOBXoHGxhLXXwCke3jQXRCiXMU0oGUVotVM8fl+bRht75+mLN/qj8ZEMaBd3MqkZMWxRefPK44EbfHIMayNDAV2KSbICT6Kfo9qBYn2og41Kyj4NKq9D0X++H9TiF6wa19oVLyg06ZBqA/A5X0tQUpqoh6od+JW+xjtsa3PbU0Vd8QToXD8WoRVzR3MjwNYT5LZ/dNxdvowXEz3l8MEZhjt4KjVMrKNyfLFInmC+90iEGyLTHXQAm3X4Yv1XATb+8uX12+XcPeppRahKY9qzRAVEUkqB8VQKFgFoSklUB0Pp7mRw1krN7BUgRrSxveUZ4Jwp7T2WW4DNt3+7J+wn1+g68XWtCZeXNW22ecvWLZN2pNNattZmz3IY99Wu0W7qDsZSpPxVFLPOD+wO40SrdSBfqtGRa4Ol0I4usoUZurAAYma1x8Rt0s0nfQeVUl1eTgpNvzWehzlfmQ4JUybCTclFrqZdUnxgqrysUYEHWVk/TeQzvcx4coJI/Zjc7jIDugzVyWh+rPMo/D4xpDe5auloWMyiS+2HPKPHA2kFCbXZXZGqlDgCPyNTsAQ2irUso1tAMmi80qIPk5ezKVpXFgS2VptbOBl0i1iNA6Z4tN8C5RusUgZBMK/ORl+zodLXC4ASZZn70DtXQG91YVpVNbj4EpNYtKfWJUa4nAeIlbOw5UwVXrnwvB0cc0WNJig+V3BuTAwUNbPd9g+Vg1NC9v3Sik+YnKAJtCcsxKRFfY2/RMbduHxFxDtWXErrUxecA3gA41Ab3prDNoD/a0gN9Z56rhJAIcS2Pgscog2xOHs10CGF0FrJqPJrdSD8ad55bKAbjAL/5sSUGlV1AZ5UkKv9Ttz/0EKuv6sB51yX/T1SdN9QROdwnd+d4tlSy4i8zCteGVbTio+WLwsQbLIzWrkSp0rz110OimfwoQo7rSPCk3IAgKn2tOCV6xAJ/VdlNiXeprhcTPOpZmeogSGG4FoA7SgIJ9nlY1XBu8lraubafVrQWvKAClIZeQgMUsHx5mBdBanOcMwBoWSyC7pxTqfm7P1JIMOtfFGpTp+njVfHIXeuNMCBShriZrEb/YHDCqVsDOBshnVWxFEW2cL4d0YKYlGQWYEJID4GlBVKejYdXqTyNoGIscFzqVjvkSL+afzWV85toeWhRE5dYV/cxzLc+3eXuouzg8MuL+yRgfGqsdO8Y2AuobiW/6FoGQ7QlGzj4OUzkktUQbk/C4GflBUKbzq4czKzD/kxLgp/yv7/iD7LvUjO4GY3TtaHKa2yenvZFdQ5fp5kBND8w6hrxx6Lu0YPfcr8PTCv7r/wGXBVjwe4EAAA==";
let photoManifestPromise: Promise<PhotoImportEntry[]> | null = null;

async function readPhotoManifest() {
  if (!photoManifestPromise) {
    photoManifestPromise = (async () => {
      const compressed = Uint8Array.from(atob(PHOTO_IMPORT_GZIP_BASE64), (char) => char.charCodeAt(0));
      const body = new Response(compressed).body;
      if (!body) throw new Error("Photo manifest could not be read");
      const json = await new Response(body.pipeThrough(new DecompressionStream("gzip"))).text();
      const parsed = JSON.parse(json) as PhotoImportEntry[];
      const replacementSources: Record<number, string> = {
        50: "https://fastmall.co.kr/web/product/small/202509/71dfd22915cc30bf857a281c62cc3f16.jpg",
        61: "https://asset.m-gs.kr/prod/1046672367/1/550",
        93: "https://sehyeon.s3.us-east-2.amazonaws.com/010714.jpg",
      };
      for (const [rawIndex, sourceUrl] of Object.entries(replacementSources)) {
        const entry = parsed[Number(rawIndex)];
        if (entry) entry.sourceUrl = sourceUrl;
      }
      return parsed;
    })();
  }
  return photoManifestPromise;
}

async function importPhotoEntry(entry: PhotoImportEntry) {
  const database = db();
  const storage = bindings().STORAGE;
  if (!storage) throw new Error("R2 storage binding unavailable");

  let object = await storage.head(entry.key);
  let transformed = false;
  let contentType = "image/webp";

  if (!object) {
    let response: Response | null = null;
    try {
      response = await fetch(entry.sourceUrl, {
        headers: {
          "Accept": "image/webp,image/*,*/*;q=0.8",
          "User-Agent": "Mozilla/5.0 (compatible; BujaFoodCatalog/1.0)",
        },
        cf: {
          image: {
            width: 1200,
            height: 1200,
            fit: "pad",
            background: "#ffffff",
            format: "webp",
            quality: 85,
            metadata: "none",
          },
        },
      } as any);
      transformed = response.ok && (response.headers.get("content-type") || "").includes("image/webp");
    } catch {
      response = null;
    }

    if (!response?.ok || !(response.headers.get("content-type") || "").startsWith("image/")) {
      response = await fetch(entry.sourceUrl, {
        headers: {
          "Accept": "image/*,*/*;q=0.8",
          "User-Agent": "Mozilla/5.0 (compatible; BujaFoodCatalog/1.0)",
        },
        redirect: "follow",
      });
      transformed = false;
    }

    if (!response.ok) throw new Error(`upstream ${response.status}`);
    contentType = response.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    if (!contentType.startsWith("image/")) throw new Error(`not an image: ${contentType}`);
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength) throw new Error("empty image");
    if (bytes.byteLength > 20 * 1024 * 1024) throw new Error("image too large");

    await storage.put(entry.key, bytes, {
      httpMetadata: {
        contentType: transformed ? "image/webp" : contentType,
        cacheControl: "public, max-age=31536000, immutable",
      },
      customMetadata: {
        source: entry.sourceUrl.slice(0, 900),
        transformed: transformed ? "webp-1200-pad" : "original-fallback",
      },
    });
    object = await storage.head(entry.key);
  } else {
    transformed = object.httpMetadata?.contentType === "image/webp";
    contentType = object.httpMetadata?.contentType || "application/octet-stream";
  }

  if (!object) throw new Error("R2 write failed");
  const photoUrl = `/api/photo?id=${entry.key}`;
  await database.batch(
    entry.productIds.map((id) =>
      database.prepare("UPDATE products SET photo=? WHERE id=?").bind(photoUrl, id),
    ),
  );

  return { products: entry.productIds.length, transformed, contentType };
}

async function runPhotoImport(retryOnly = false) {
  const database = db();
  const manifest = await readPhotoManifest();
  const indexRow = await database
    .prepare("SELECT value FROM app_settings WHERE key='photo_import_v1_index'")
    .first<{ value: string }>();
  const failuresRow = await database
    .prepare("SELECT value FROM app_settings WHERE key='photo_import_v1_failures'")
    .first<{ value: string }>();

  let index = Math.max(0, Number(indexRow?.value || 0) || 0);
  const failures = new Set<number>(
    (failuresRow?.value || "")
      .split(",")
      .map((v) => Number(v))
      .filter((v) => Number.isInteger(v) && v >= 0 && v < manifest.length),
  );

  const batchSize = 8;
  const indexes = retryOnly
    ? [...failures].slice(0, batchSize)
    : Array.from({ length: Math.min(batchSize, manifest.length - index) }, (_, offset) => index + offset);

  const results = await Promise.all(indexes.map(async (entryIndex) => {
    try {
      const result = await importPhotoEntry(manifest[entryIndex]);
      failures.delete(entryIndex);
      return { index: entryIndex, ok: true, ...result };
    } catch (error) {
      failures.add(entryIndex);
      return {
        index: entryIndex,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }));

  if (!retryOnly && indexes.length) index = indexes[indexes.length - 1] + 1;

  await database.batch([
    database
      .prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('photo_import_v1_index',?)")
      .bind(String(index)),
    database
      .prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('photo_import_v1_failures',?)")
      .bind([...failures].sort((a, b) => a - b).join(",")),
    database
      .prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('photo_import_v1_done',?)")
      .bind(index >= manifest.length && failures.size === 0 ? "1" : "0"),
  ]);

  const linked = await database
    .prepare("SELECT COUNT(*) AS count FROM products WHERE id LIKE 'ERP-%' AND photo LIKE '/api/photo?id=catalog-%'")
    .first<{ count: number }>();

  return {
    totalSources: manifest.length,
    sourceIndex: index,
    remainingSources: Math.max(0, manifest.length - index),
    failures: [...failures].sort((a, b) => a - b),
    failedCount: failures.size,
    linkedProducts: Number(linked?.count ?? 0),
    results,
    done: index >= manifest.length && failures.size === 0,
  };
}

async function photoImportStatus() {
  const database = db();
  const manifest = await readPhotoManifest();
  const [indexRow, failuresRow, doneRow, linked, productRows] = await Promise.all([
    database.prepare("SELECT value FROM app_settings WHERE key='photo_import_v1_index'").first<{ value: string }>(),
    database.prepare("SELECT value FROM app_settings WHERE key='photo_import_v1_failures'").first<{ value: string }>(),
    database.prepare("SELECT value FROM app_settings WHERE key='photo_import_v1_done'").first<{ value: string }>(),
    database.prepare("SELECT COUNT(*) AS count FROM products WHERE id LIKE 'ERP-%' AND photo LIKE '/api/photo?id=catalog-%'").first<{ count: number }>(),
    database.prepare("SELECT id, name, photo FROM products WHERE id LIKE 'ERP-%'").all(),
  ]);
  const index = Number(indexRow?.value || 0) || 0;
  const failures = (failuresRow?.value || "").split(",").filter(Boolean);
  const productById = new Map(
    (productRows.results as Array<Record<string, unknown>>).map((row) => [
      String(row.id),
      { name: String(row.name ?? ""), photo: String(row.photo ?? "") },
    ]),
  );
  const targetIds = [...new Set(manifest.flatMap((entry) => entry.productIds))];
  const expectedById = new Map(
    manifest.flatMap((entry) => entry.productIds.map((id) => [id, `/api/photo?id=${entry.key}`] as const)),
  );
  const unlinkedProducts = targetIds.filter((id) => !productById.get(id)?.photo.startsWith("/api/photo?id=catalog-"));
  const unlinkedDetails = unlinkedProducts.map((id) => ({
    id,
    exists: productById.has(id),
    name: productById.get(id)?.name ?? "",
    photo: productById.get(id)?.photo ?? "",
    expected: expectedById.get(id) ?? "",
  }));

  const expectedCatalogIds = new Set<string>();
  for (const sql of CATALOG_SQL_CHUNKS) {
    if (!/^INSERT\s+(?:OR\s+REPLACE\s+)?INTO\s+products\b/i.test(sql.trimStart())) continue;
    for (const match of sql.matchAll(/\('(ERP-[^']+)'/g)) {
      const id = match[1];
      if (id) expectedCatalogIds.add(id);
    }
  }
  const liveErpIds = new Set(
    (productRows.results as Array<Record<string, unknown>>).map((row) => String(row.id)),
  );
  const catalogMissing = [...expectedCatalogIds].filter((id) => !liveErpIds.has(id));
  const catalogUnexpected = [...liveErpIds].filter((id) => !expectedCatalogIds.has(id));

  return {
    totalSources: manifest.length,
    sourceIndex: index,
    remainingSources: Math.max(0, manifest.length - index),
    failedCount: failures.length,
    failures,
    linkedProducts: Number(linked?.count ?? 0),
    targetProducts: targetIds.length,
    unlinkedProducts,
    unlinkedDetails,
    originalCatalogExpected: expectedCatalogIds.size,
    liveErpProducts: liveErpIds.size,
    catalogMissing,
    catalogUnexpected,
    done: doneRow?.value === "1",
  };
}

async function searchCatalogImageCandidates(query: string) {
  const searchUrl = "https://www.bing.com/images/search?q=" + encodeURIComponent(query) + "&form=HDRSC3&first=1";
  const response = await fetch(searchUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/156 Safari/537.36",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.5",
    },
    redirect: "follow",
  });
  const html = await response.text();
  const candidates: Array<{ url: string; title: string }> = [];
  const seen = new Set<string>();

  const decodeHtml = (value: string) => value
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

  // Current Bing image results store per-card metadata in the m="..." attribute.
  for (const attr of html.matchAll(/\sm="([^"]+)"/g)) {
    const metadata = decodeHtml(attr[1] || "");
    const urlMatch = metadata.match(/"murl":"([^"]+)"/);
    if (!urlMatch) continue;
    const titleMatch = metadata.match(/"t":"([^"]*)"/);
    const url = (urlMatch[1] || "").replaceAll("\\u002f", "/").replaceAll("\\/", "/");
    const title = decodeHtml(titleMatch?.[1] || "");
    if (url.startsWith("http") && !seen.has(url)) {
      seen.add(url);
      candidates.push({ url, title });
      if (candidates.length >= 20) break;
    }
  }

  // Fallback: Bing detail links expose mediaurl even if card metadata changes.
  if (!candidates.length) {
    for (const match of html.matchAll(/[?&]mediaurl=([^&"']+)/g)) {
      try {
        const url = decodeURIComponent(decodeHtml(match[1] || ""));
        if (url.startsWith("http") && !seen.has(url)) {
          seen.add(url);
          candidates.push({ url, title: query });
          if (candidates.length >= 20) break;
        }
      } catch {}
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    htmlLength: html.length,
    candidates,
  };
}

const PHOTO_AUTOFILL_TOKEN = "buja-photo-20261025-f6e3d9a4";
const PHOTO_MATCH_TERMS = [
  "김치왕만두","고기왕만두","군만두","교자만두","야끼만두","동그랑땡","새우튀김","오징어튀김",
  "치킨까스","돈까스","꿔바로우","탕수육","고로케","감자떡","꿀떡","절편","웨지감자","어묵","순대",
  "런천미트","갈치","고등어","조기","민어","가자미","아귀","낙지","문어","오징어","쭈꾸미","새우",
  "골뱅이","해파리","젓갈","김가루","김밥김","다시마","미역줄기","미역","진미채","북어채","명엽채",
  "쥐어채","가쓰오부시","표고버섯","목이버섯","멸치","갈비","등뼈","목뼈","민찌","제육","돼지머리",
  "우족","장각","닭도리","오리","두부","곤약","청포묵","메추리알","계란","버터","마가린","단무지",
  "우엉","땅콩조림","마늘쫑","무말랭이","무쌈","피클","진간장","국간장","간장","식초","된장","쌈장",
  "청국장","고추장","춘장","당면","칼국수","막국수","스파게티","쫄면","국수","냉면","소스","육수",
  "장국","액젓","마요네즈","케찹","드레싱","다시다","설탕","전분","소금","후추","파인애플","황도",
  "후르츠칵테일","참깨","흑미","찰보리","라면","스프","커피","건포도","아몬드","도넛","꽈배기",
  "찐빵","꽃빵","세제","고무장갑","롤팩","비닐","크리너"
] as const;

function normalizeCatalogText(value: string) {
  return value.toLowerCase().replace(/[^0-9a-z가-힣]+/g, "");
}

function pickCatalogImageCandidate(name: string, candidates: Array<{ url: string; title: string }>) {
  if (!candidates.length) return null;
  const normalizedName = normalizeCatalogText(name.replace(/\([^)]*\)/g, " "));
  const terms = PHOTO_MATCH_TERMS.filter((term) => normalizedName.includes(normalizeCatalogText(term)));
  let best: { url: string; title: string; score: number } | null = null;

  for (const candidate of candidates) {
    const haystack = normalizeCatalogText(candidate.title + " " + candidate.url);
    let score = 0;
    if (normalizedName.length >= 3 && haystack.includes(normalizedName)) score += 1000;
    for (const term of terms) {
      const normalizedTerm = normalizeCatalogText(term);
      if (normalizedTerm && haystack.includes(normalizedTerm)) score += 50 + normalizedTerm.length;
    }
    if (/food|mart|mall|product|goods|shop|coupang|ssg|danawa|식자재|업소용/.test(candidate.title.toLowerCase() + " " + candidate.url.toLowerCase())) score += 4;
    if (!best || score > best.score) best = { ...candidate, score };
  }

  if (terms.length && (best?.score ?? 0) < 50) return null;
  return best;
}

async function catalogPhotoAutoFillStatus() {
  const database = db();
  const manifest = await readPhotoManifest();
  const targetIds = new Set(manifest.flatMap((entry) => entry.productIds));
  const [rows, skippedRow] = await Promise.all([
    database.prepare("SELECT id,name,category,sub,photo FROM products WHERE id LIKE 'ERP-%' ORDER BY sort_order,name").all(),
    database.prepare("SELECT value FROM app_settings WHERE key='photo_autofill_v1_skipped'").first<{ value: string }>(),
  ]);
  const targets = (rows.results as Array<Record<string, unknown>>).filter((row) => targetIds.has(String(row.id)));
  const withPhotos = targets.filter((row) => String(row.photo ?? "").trim()).length;
  const skipped = (skippedRow?.value || "").split(",").filter(Boolean);
  return {
    targetProducts: targets.length,
    withPhotos,
    blankProducts: targets.length - withPhotos,
    skippedCount: skipped.length,
    skipped,
  };
}

async function runCatalogPhotoAutoFill(limit = 8) {
  const database = db();
  const manifest = await readPhotoManifest();
  const targetIds = new Set(manifest.flatMap((entry) => entry.productIds));
  const [rows, skippedRow] = await Promise.all([
    database.prepare("SELECT id,name,category,sub,photo FROM products WHERE id LIKE 'ERP-%' ORDER BY sort_order,name").all(),
    database.prepare("SELECT value FROM app_settings WHERE key='photo_autofill_v1_skipped'").first<{ value: string }>(),
  ]);
  const skipped = new Set((skippedRow?.value || "").split(",").filter(Boolean));
  const targets = (rows.results as Array<Record<string, unknown>>)
    .filter((row) => targetIds.has(String(row.id)))
    .filter((row) => !String(row.photo ?? "").trim())
    .filter((row) => !skipped.has(String(row.id)))
    .slice(0, Math.max(1, Math.min(10, limit)));

  const results = await Promise.all(targets.map(async (row) => {
    const id = String(row.id);
    const name = String(row.name ?? "");
    const category = String(row.category ?? "");
    const sub = String(row.sub ?? "");
    const query = [name, sub, category, "업소용 대용량 식자재"].filter(Boolean).join(" ");
    try {
      const searched = await searchCatalogImageCandidates(query);
      const picked = pickCatalogImageCandidate(name, searched.candidates);
      if (!picked) throw new Error("matching image candidate not found");
      const key = `catalog-auto-${id.toLowerCase().replace(/[^a-z0-9-]/g, "")}.webp`;
      const imported = await importPhotoEntry({ key, sourceUrl: picked.url, productIds: [id] });
      return { id, name, ok: true, source: picked.url, title: picked.title, score: picked.score, ...imported };
    } catch (error) {
      skipped.add(id);
      return { id, name, ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }));

  await database
    .prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('photo_autofill_v1_skipped',?)")
    .bind([...skipped].join(","))
    .run();

  return {
    ...(await catalogPhotoAutoFillStatus()),
    processed: results.length,
    results,
  };
}

async function ensureCatalogImportV3() {
  const database = db();
  await ensureDatabase(database);

  const done = await database
    .prepare("SELECT value FROM app_settings WHERE key='excel_catalog_import_v3'")
    .first<{ value: string }>();
  if (done?.value !== "1") {
    try {
      for (const sql of CATALOG_SQL_CHUNKS) {
        if (!sql.trim()) continue;
        const normalized =
          /^INSERT\s+(?:OR\s+REPLACE\s+)?INTO\s+(?:products|pack_options)\b/i.test(sql.trimStart())
            ? sql.replace(/\n/g, " ")
            : sql;
        await database.exec(normalized);
      }
      await database.prepare("DELETE FROM app_settings WHERE key='excel_catalog_import_error'").run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Catalog v3 import failed", error);
      try {
        await database
          .prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('excel_catalog_import_error',?)")
          .bind(message.slice(0, 1000))
          .run();
      } catch {}
    }
  }

  const missingPhotoProducts = await database
    .prepare("SELECT id FROM products WHERE id IN ('ERP-31085','ERP-32576','ERP-31032','ERP-30544')")
    .all();
  const existingPhotoProductIds = new Set(
    (missingPhotoProducts.results as Array<Record<string, unknown>>).map((row) => String(row.id)),
  );
  if (existingPhotoProductIds.size < 4) {
    await database.batch([
      database.prepare("INSERT OR IGNORE INTO products (id,name,category,sub,unit,price,soldout,photo,sort_order,tax_type,warehouse_zone,description,servings_per_unit,box_contents,servings_per_box,storage_method,price_list_visible,price_display_mode,hidden,promo_price) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind("ERP-31085","갈비맛치킨꼬치","냉동식품","튀김·가스","0.5kg",0,0,"/api/photo?id=catalog-5b6813d8b08f39670d92.webp",1003,"taxable","","","","","","",1,"inquiry",0,null),
      database.prepare("INSERT OR IGNORE INTO products (id,name,category,sub,unit,price,soldout,photo,sort_order,tax_type,warehouse_zone,description,servings_per_unit,box_contents,servings_per_box,storage_method,price_list_visible,price_display_mode,hidden,promo_price) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind("ERP-32576","치즈돈까스 (면사랑)","냉동식품","튀김·가스","8kg",84000,0,"/api/photo?id=catalog-0e2dccd17b3c1e85728f.webp",1062,"taxable","","","","4","","",1,"fixed",0,null),
      database.prepare("INSERT OR IGNORE INTO products (id,name,category,sub,unit,price,soldout,photo,sort_order,tax_type,warehouse_zone,description,servings_per_unit,box_contents,servings_per_box,storage_method,price_list_visible,price_display_mode,hidden,promo_price) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind("ERP-31032","치킨너겟 (상도)","냉동식품","튀김·가스","10kg",49000,0,"/api/photo?id=catalog-2c99660f7797ecd82c01.webp",1067,"taxable","","","","10","","",1,"fixed",0,null),
      database.prepare("INSERT OR IGNORE INTO products (id,name,category,sub,unit,price,soldout,photo,sort_order,tax_type,warehouse_zone,description,servings_per_unit,box_contents,servings_per_box,storage_method,price_list_visible,price_display_mode,hidden,promo_price) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind("ERP-30544","치킨너겟(오양)","냉동식품","튀김·가스","10kg",59000,0,"/api/photo?id=catalog-47b62e79a081537bf0ae.webp",1070,"taxable","","","","10","","",1,"fixed",0,null),
    ]);
    await database.batch([
      database.prepare("INSERT INTO pack_options (product_id,label,spec,price,step,sort_order) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM pack_options WHERE product_id=?)")
        .bind("ERP-31085","봉지","0.5kg",null,1,0,"ERP-31085"),
      database.prepare("INSERT INTO pack_options (product_id,label,spec,price,step,sort_order) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM pack_options WHERE product_id=?)")
        .bind("ERP-32576","박스","8kg",84000,1,0,"ERP-32576"),
      database.prepare("INSERT INTO pack_options (product_id,label,spec,price,step,sort_order) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM pack_options WHERE product_id=?)")
        .bind("ERP-31032","박스","10kg",49000,1,0,"ERP-31032"),
      database.prepare("INSERT INTO pack_options (product_id,label,spec,price,step,sort_order) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM pack_options WHERE product_id=?)")
        .bind("ERP-30544","박스","10kg",59000,1,0,"ERP-30544"),
    ]);
  }

  await database.batch([
    database.prepare("UPDATE products SET photo=?, hidden=0, soldout=0, price_list_visible=1 WHERE id=?").bind("/api/photo?id=catalog-5b6813d8b08f39670d92.webp", "ERP-31085"),
    database.prepare("UPDATE products SET photo=?, hidden=0, soldout=0, price_list_visible=1 WHERE id=?").bind("/api/photo?id=catalog-0e2dccd17b3c1e85728f.webp", "ERP-32576"),
    database.prepare("UPDATE products SET photo=?, hidden=0, soldout=0, price_list_visible=1 WHERE id=?").bind("/api/photo?id=catalog-2c99660f7797ecd82c01.webp", "ERP-31032"),
    database.prepare("UPDATE products SET photo=?, hidden=0, soldout=0, price_list_visible=1 WHERE id=?").bind("/api/photo?id=catalog-47b62e79a081537bf0ae.webp", "ERP-30544"),
  ]);

  const photoPrecisionReset = await database
    .prepare("SELECT value FROM app_settings WHERE key='catalog_photo_precision_reset_v1'")
    .first<{ value: string }>();
  if (photoPrecisionReset?.value !== "1") {
    await database.batch([
      database.prepare(`UPDATE products
        SET photo=''
        WHERE id LIKE 'ERP-%'
          AND photo LIKE '/api/photo?id=catalog-%'
          AND id NOT IN ('ERP-30588','ERP-30579','ERP-32363','ERP-30365','ERP-30120','ERP-30024','ERP-32244','ERP-32374','ERP-32844','ERP-32845','ERP-32163','ERP-32401','ERP-30364','ERP-31032','ERP-32676','ERP-30544','ERP-32411','ERP-30352','ERP-30076','ERP-31039','ERP-30960','ERP-31019','ERP-32851','ERP-8097','ERP-32077','ERP-32072','ERP-32073','ERP-8047','ERP-8037','ERP-30369','ERP-32476','ERP-30234','ERP-31666')`),
      database.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('catalog_photo_precision_reset_v1','1')"),
    ]);
  }

  const safePhotosRestored = await database
    .prepare("SELECT value FROM app_settings WHERE key='catalog_photo_safe_restore_v1'")
    .first<{ value: string }>();
  if (safePhotosRestored?.value !== "1") {
    const statements = SAFE_CATALOG_PHOTOS.map(([id, photo]) =>
      database.prepare("UPDATE products SET photo=? WHERE id=?").bind(photo, id),
    );
    for (let i = 0; i < statements.length; i += 80) {
      await database.batch(statements.slice(i, i + 80));
    }
    await database
      .prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('catalog_photo_safe_restore_v1','1')")
      .run();
  }

  // User manually reviewed product-management pages 1-7 (first 140 products).
  // Apply only verified page-8 photo corrections and never touch those protected rows.
  const page8PhotoCorrections = await database
    .prepare("SELECT value FROM app_settings WHERE key='page8_photo_corrections_v1'")
    .first<{ value: string }>();
  if (page8PhotoCorrections?.value !== "1") {
    const corrections: PhotoImportEntry[] = [
      {
        key: "catalog-page8-erp-32829.webp",
        sourceUrl: "https://cdn-optimized.imweb.me/upload/S20230128803e0b9d46aae/8fdde19286d74.jpg?w=750",
        productIds: ["ERP-32829"],
      },
      {
        key: "catalog-page8-erp-32832.webp",
        sourceUrl: "https://cdn-optimized.imweb.me/upload/S20250829e8d96c2258588/3c58ddd217eba.png?w=750",
        productIds: ["ERP-32832"],
      },
      {
        key: "catalog-page8-erp-31351.webp",
        sourceUrl: "https://cdn-optimized.imweb.me/upload/S20250829e8d96c2258588/3530a689586c2.png?w=750",
        productIds: ["ERP-31351"],
      },
      {
        key: "catalog-page8-erp-31410.webp",
        sourceUrl: "https://cdn.imweb.me/thumbnail/20251118/b8eba1e5f5958.png",
        productIds: ["ERP-31410"],
      },
      {
        key: "catalog-page8-erp-32478.webp",
        sourceUrl: "https://seanfoodmall.com/web/upload/NNEditor/20200213/4b4bfe504ccd36154f71cec0f78366a7.jpg",
        productIds: ["ERP-32478"],
      },
      {
        key: "catalog-page8-erp-32852.webp",
        sourceUrl: "https://cdn-optimized.imweb.me/upload/S20250829e8d96c2258588/7d2c71515f8c5.png?w=750",
        productIds: ["ERP-32852"],
      },
    ];

    const correctionErrors: string[] = [];
    for (const correction of corrections) {
      const id = correction.productIds[0] || "";
      const existing = id
        ? await database.prepare("SELECT photo FROM products WHERE id=?").bind(id).first<{ photo: string }>()
        : null;
      // The live catalog can change while the user is manually cleaning products.
      // Missing products are not errors and must not make every store request retry old photo imports.
      if (!existing) continue;
      if ((existing.photo || "").includes(`/api/photo?id=${correction.key}`)) continue;
      try {
        await importPhotoEntry(correction);
      } catch (error) {
        correctionErrors.push(`${id || correction.key}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (correctionErrors.length === 0) {
      await database.batch([
        database.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('page8_photo_corrections_v1','1')"),
        database.prepare("DELETE FROM app_settings WHERE key='page8_photo_corrections_v1_error'"),
      ]);
    } else {
      await database
        .prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('page8_photo_corrections_v1_error',?)")
        .bind(correctionErrors.join(" | ").slice(0, 1800))
        .run();
      console.error("Page 8 photo corrections incomplete", correctionErrors);
    }
  }

  const page8PhotoCorrectionsV2 = await database
    .prepare("SELECT value FROM app_settings WHERE key='page8_photo_corrections_v2'")
    .first<{ value: string }>();
  if (page8PhotoCorrectionsV2?.value !== "1") {
    try {
      await importPhotoEntry({
        key: "catalog-page8-erp-1063.webp",
        sourceUrl: "https://content.foodspring.co.kr/vendor/3841/images/65_5581092641_r.jpg",
        productIds: ["ERP-1063"],
      });
      await database.batch([
        database.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('page8_photo_corrections_v2','1')"),
        database.prepare("DELETE FROM app_settings WHERE key='page8_photo_corrections_v2_error'"),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await database
        .prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('page8_photo_corrections_v2_error',?)")
        .bind(message.slice(0, 1000))
        .run();
      console.error("Page 8 photo correction v2 incomplete", error);
    }
  }

  const page9PhotoCorrectionsV1 = await database
    .prepare("SELECT value FROM app_settings WHERE key='page9_photo_corrections_v1'")
    .first<{ value: string }>();
  if (page9PhotoCorrectionsV1?.value !== "1") {
    const corrections: PhotoImportEntry[] = [
      {
        key: "catalog-page9-erp-32370.webp",
        sourceUrl: "https://seinsusan.kr/web/product/small/202306/58510470b152bd4ab20adb1ae1108ff4.png",
        productIds: ["ERP-32370"],
      },
      {
        key: "catalog-page9-erp-32225.webp",
        sourceUrl: "https://ecimg.cafe24img.com/pg851b80444222023/op98700/web/product/small/20240510/8a5bce3f9d5593b3577451f22481f1a8.jpg",
        productIds: ["ERP-32225"],
      },
      {
        key: "catalog-page9-erp-32786.webp",
        sourceUrl: "https://www.fooden.com//_data/product/img/241-000189/3de1d9a57ac90029dd10017d99b22f42.png",
        productIds: ["ERP-32786"],
      },
    ];

    const correctionErrors: string[] = [];
    for (const correction of corrections) {
      try {
        await importPhotoEntry(correction);
      } catch (error) {
        const id = correction.productIds[0] || correction.key;
        correctionErrors.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (correctionErrors.length === 0) {
      await database.batch([
        database.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('page9_photo_corrections_v1','1')"),
        database.prepare("DELETE FROM app_settings WHERE key='page9_photo_corrections_v1_error'"),
      ]);
    } else {
      await database
        .prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('page9_photo_corrections_v1_error',?)")
        .bind(correctionErrors.join(" | ").slice(0, 1800))
        .run();
      console.error("Page 9 photo corrections incomplete", correctionErrors);
    }
  }

  const page10PhotoCorrectionsV1 = await database
    .prepare("SELECT value FROM app_settings WHERE key='page10_photo_corrections_v1'")
    .first<{ value: string }>();
  if (page10PhotoCorrectionsV1?.value !== "1") {
    const corrections: PhotoImportEntry[] = [
      {
        key: "catalog-page10-erp-33023.webp",
        sourceUrl: "https://cdn.011st.com/11src/product/8926377105/B.webp?180852565=",
        productIds: ["ERP-33023"],
      },
      {
        key: "catalog-page10-erp-33024.webp",
        sourceUrl: "https://thumbnail.coupangcdn.com/thumbnails/remote/492x492ex/image/retail/images/3604838363584295-6efeebb8-02f1-45ca-9846-73be4094f98f.jpg",
        productIds: ["ERP-33024"],
      },
      {
        key: "catalog-page10-erp-32439.webp",
        sourceUrl: "https://image.coupangcdn.com/image/retail/images/3043017785244780-0ffe4106-9cb7-4b82-ad07-12559c3f7803.jpg",
        productIds: ["ERP-32439"],
      },
      {
        key: "catalog-page10-erp-32665.webp",
        sourceUrl: "https://ecimg.cafe24img.com/pg851b80444222023/op98700/web/product/big/20250521/f8eca52f1892150878f8af615a46bada.jpg",
        productIds: ["ERP-32665"],
      },
      {
        key: "catalog-page10-erp-32468.webp",
        sourceUrl: "https://thumbnail.coupangcdn.com/thumbnails/remote/492x492ex/image/vendor_inventory/ee0e/6ecbc78cf63e42fea25369b21fac12571a1298a20ce790ae2aa86b063b52.png",
        productIds: ["ERP-32468"],
      },
      {
        key: "catalog-page10-erp-32192.webp",
        sourceUrl: "https://m.seinsusan.kr/web/product/big/202308/87728bf8f9b1dd65c470ca1ccc7bfa7e.png",
        productIds: ["ERP-32192"],
      },
      {
        key: "catalog-page10-erp-31895.webp",
        sourceUrl: "https://static.chabyulhwa.com/products/images/720x720x80/202407/%EC%9A%B0%EB%A0%81%EC%82%B4%20%EC%8D%B8%EB%84%A4%EC%9D%BC_7fd5e2a2-5d8e-4d87-9346-ee91c6f3fd01.png",
        productIds: ["ERP-31895"],
      },
      {
        key: "catalog-page10-erp-32780.webp",
        sourceUrl: "https://content.foodspring.co.kr/vendor/2578/images/78_2814119592_r.jpg",
        productIds: ["ERP-32780"],
      },
      {
        key: "catalog-page10-erp-32195.webp",
        sourceUrl: "https://m.wandojb.co.kr/web/product/big/201908/4df3cac7655b29f329817e86162a0aba.jpg",
        productIds: ["ERP-32195"],
      },
    ];

    const correctionErrors: string[] = [];
    for (const correction of corrections) {
      try {
        await importPhotoEntry(correction);
      } catch (error) {
        const id = correction.productIds[0] || correction.key;
        correctionErrors.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (correctionErrors.length === 0) {
      await database.batch([
        database.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('page10_photo_corrections_v1','1')"),
        database.prepare("DELETE FROM app_settings WHERE key='page10_photo_corrections_v1_error'"),
      ]);
    } else {
      await database
        .prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('page10_photo_corrections_v1_error',?)")
        .bind(correctionErrors.join(" | ").slice(0, 1800))
        .run();
      console.error("Page 10 photo corrections incomplete", correctionErrors);
    }
  }

  const page11PhotoCorrectionsV1 = await database
    .prepare("SELECT value FROM app_settings WHERE key='page11_photo_corrections_v1'")
    .first<{ value: string }>();
  if (page11PhotoCorrectionsV1?.value !== "1") {
    const id = "ERP-31133";
    const existing = await database.prepare("SELECT photo FROM products WHERE id=?").bind(id).first<{ photo: string }>();
    try {
      if (existing && !(existing.photo || "").trim()) {
        await importPhotoEntry({
          key: "catalog-page11-erp-31133.webp",
          sourceUrl: "https://www.ewangmart.com/data/base/goods/big/8809352250031_1.jpg",
          productIds: [id],
        });
      }
      await database.batch([
        database.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('page11_photo_corrections_v1','1')"),
        database.prepare("DELETE FROM app_settings WHERE key='page11_photo_corrections_v1_error'"),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await database
        .prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('page11_photo_corrections_v1_error',?)")
        .bind(message.slice(0, 1000))
        .run();
      console.error("Page 11 photo correction incomplete", error);
    }
  }

  const current283PhotoCorrectionsV1 = await database
    .prepare("SELECT value FROM app_settings WHERE key='current_283_photo_corrections_v1'")
    .first<{ value: string }>();
  if (current283PhotoCorrectionsV1?.value !== "1") {
    const fillIfBlank: PhotoImportEntry[] = [
      {
        key: "catalog-current283-erp-5003.webp",
        sourceUrl: "https://www.k-and-e29.com/shopping/up_img/1761987296-329486_1.jpg",
        productIds: ["ERP-5003"],
      },
      {
        key: "catalog-current283-erp-5004.webp",
        sourceUrl: "https://m.chorokdeul.com/web/product/big/201703/167_shop1_492133.jpg",
        productIds: ["ERP-5004"],
      },
      {
        key: "catalog-current283-erp-32843.webp",
        sourceUrl: "https://images.onetimepim.com/acc-144/images/606039.png?twic=v1%2Fresize-max%3D800x-%2Fresize-max%3D-x800%2Foutput%3Dwebp",
        productIds: ["ERP-32843"],
      },
      {
        key: "catalog-current283-erp-32154.webp",
        sourceUrl: "https://alwholesale.ae/cdn/shop/files/pilgrims_drumstic2_1024x1024.jpg?v=1743755150",
        productIds: ["ERP-32154"],
      },
      {
        key: "catalog-current283-erp-30436.webp",
        sourceUrl: "https://gfoodninea.speedgabia.com/foodnine/list/s140956_1.jpg",
        productIds: ["ERP-30436"],
      },
      {
        key: "catalog-current283-erp-30124.webp",
        sourceUrl: "https://img.danuri.io/catalog-image/937/208/015/8ae0c942c7d748fead4fe543500a696d.jpg?_v=20260410024618",
        productIds: ["ERP-30124"],
      },
      {
        key: "catalog-current283-erp-31373.webp",
        sourceUrl: "https://static.megamart.com/product/image/0530/05303106/05303106_1_960.jpg",
        productIds: ["ERP-31373"],
      },
      {
        key: "catalog-current283-erp-32878.webp",
        sourceUrl: "https://news.nateimg.co.kr/orgImg/wh/2025/05/28/1222640_1425441_2046.jpg",
        productIds: ["ERP-32878"],
      },
    ];

    const replaceFlagged: PhotoImportEntry[] = [
      {
        key: "catalog-current283-erp-32199.webp",
        sourceUrl: "https://m.xn--299ayyo6jh9g9pm93g.kr/web/product/big/202405/912821c138cabafe6bed6e6c08e19595.jpg",
        productIds: ["ERP-32199"],
      },
      {
        key: "catalog-current283-erp-31586.webp",
        sourceUrl: "https://img-cdn.meatbox.co.kr/m/images/itemImage/2020/12/28/10/41/thumb_product_25950_1_20201228104150.jpg",
        productIds: ["ERP-31586"],
      },
    ];

    const correctionErrors: string[] = [];
    for (const correction of fillIfBlank) {
      const id = correction.productIds[0] || "";
      const existing = id
        ? await database.prepare("SELECT photo FROM products WHERE id=?").bind(id).first<{ photo: string }>()
        : null;
      if (!existing || (existing.photo || "").trim()) continue;
      try {
        await importPhotoEntry(correction);
      } catch (error) {
        correctionErrors.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    for (const correction of replaceFlagged) {
      const id = correction.productIds[0] || "";
      const existing = id
        ? await database.prepare("SELECT name FROM products WHERE id=?").bind(id).first<{ name: string }>()
        : null;
      if (!existing || !String(existing.name || "").includes("이미지수정필요")) continue;
      try {
        await importPhotoEntry(correction);
        const cleanName = String(existing.name || "")
          .replace(/\s*\/\s*이미지수정필요\s*/g, " ")
          .replace(/\s{2,}/g, " ")
          .trim();
        await database.prepare("UPDATE products SET name=? WHERE id=?").bind(cleanName, id).run();
      } catch (error) {
        correctionErrors.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (correctionErrors.length === 0) {
      await database.batch([
        database.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('current_283_photo_corrections_v1','1')"),
        database.prepare("DELETE FROM app_settings WHERE key='current_283_photo_corrections_v1_error'"),
      ]);
    } else {
      await database
        .prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('current_283_photo_corrections_v1_error',?)")
        .bind(correctionErrors.join(" | ").slice(0, 1800))
        .run();
      console.error("Current 1-283 photo corrections incomplete", correctionErrors);
    }
  }

  const original141283DuplicateFixesV1 = await database
    .prepare("SELECT value FROM app_settings WHERE key='original_141_283_duplicate_fixes_v1'")
    .first<{ value: string }>();
  if (original141283DuplicateFixesV1?.value !== "1") {
    const fixes: Array<PhotoImportEntry & { expectedPhoto: string }> = [
      {
        key: "catalog-original-276-erp-30643.webp",
        sourceUrl: "https://static.chabyulhwa.com/products/images/720x720x80/archive/20230614/bulk/4012984/4012984_0.png",
        productIds: ["ERP-30643"],
        expectedPhoto: "/api/photo?id=catalog-615db3ec9ed2d8ee7af6.webp",
      },
      {
        key: "catalog-original-278-erp-32748.webp",
        sourceUrl: "https://img.danawa.com/prod_img/500000/001/371/img/7371001_1.jpg?_v=20221110093240",
        productIds: ["ERP-32748"],
        expectedPhoto: "/api/photo?id=catalog-615db3ec9ed2d8ee7af6.webp",
      },
      {
        key: "catalog-original-251-erp-9014.webp",
        sourceUrl: "https://cdn.imweb.me/thumbnail/20210910/5e72623d66a0d.png",
        productIds: ["ERP-9014"],
        expectedPhoto: "/api/photo?id=catalog-7b217682974689d8d309.webp",
      },
      {
        key: "catalog-original-270-erp-9018.webp",
        sourceUrl: "https://content.foodspring.co.kr/vendor/1631/images/99_8223152758_r.jpg",
        productIds: ["ERP-9018"],
        expectedPhoto: "/api/photo?id=catalog-7b217682974689d8d309.webp",
      },
      {
        key: "catalog-original-246-erp-30257.webp",
        sourceUrl: "https://cdn.imweb.me/thumbnail/20210911/fec06f4127f1b.jpg",
        productIds: ["ERP-30257"],
        expectedPhoto: "/api/photo?id=catalog-d3735b48e534920b9ce7.webp",
      },
      {
        key: "catalog-original-255-erp-31204.webp",
        sourceUrl: "https://gred.s3.ap-northeast-2.amazonaws.com/vendor/1388/images/83_1240621053.jpg",
        productIds: ["ERP-31204"],
        expectedPhoto: "/api/photo?id=catalog-d3735b48e534920b9ce7.webp",
      },
    ];

    const errors: string[] = [];
    for (const fix of fixes) {
      const id = fix.productIds[0] || "";
      const existing = id
        ? await database.prepare("SELECT photo FROM products WHERE id=?").bind(id).first<{ photo: string }>()
        : null;
      // Never overwrite a photo the user changed while this cleanup is running.
      if (!existing || String(existing.photo || "") !== fix.expectedPhoto) continue;
      try {
        await importPhotoEntry(fix);
      } catch (error) {
        errors.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (errors.length === 0) {
      await database.batch([
        database.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('original_141_283_duplicate_fixes_v1','1')"),
        database.prepare("DELETE FROM app_settings WHERE key='original_141_283_duplicate_fixes_v1_error'"),
      ]);
    } else {
      await database
        .prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('original_141_283_duplicate_fixes_v1_error',?)")
        .bind(errors.join(" | ").slice(0, 1800))
        .run();
      console.error("Original 141-283 duplicate photo fixes incomplete", errors);
    }
  }

  const original141283DuplicateFixesV2 = await database
    .prepare("SELECT value FROM app_settings WHERE key='original_141_283_duplicate_fixes_v2'")
    .first<{ value: string }>();
  if (original141283DuplicateFixesV2?.value !== "1") {
    const fixes: Array<PhotoImportEntry & { expectedPhoto: string }> = [
      {
        key: "catalog-original-250-erp-9013.webp",
        sourceUrl: "https://image.auction.co.kr/itemimage/30/b6/db/30b6db2a86.jpg",
        productIds: ["ERP-9013"],
        expectedPhoto: "/api/photo?id=catalog-147ad117a97a5076f53f.webp",
      },
      {
        key: "catalog-original-252-erp-9028.webp",
        sourceUrl: "https://gdimg.gmarket.co.kr/1940186591/still/600?ver=1774963940",
        productIds: ["ERP-9028"],
        expectedPhoto: "/api/photo?id=catalog-147ad117a97a5076f53f.webp",
      },
    ];

    const errors: string[] = [];
    for (const fix of fixes) {
      const id = fix.productIds[0] || "";
      const existing = id
        ? await database.prepare("SELECT photo FROM products WHERE id=?").bind(id).first<{ photo: string }>()
        : null;
      if (!existing || String(existing.photo || "") !== fix.expectedPhoto) continue;
      try {
        await importPhotoEntry(fix);
      } catch (error) {
        errors.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (errors.length === 0) {
      await database.batch([
        database.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('original_141_283_duplicate_fixes_v2','1')"),
        database.prepare("DELETE FROM app_settings WHERE key='original_141_283_duplicate_fixes_v2_error'"),
      ]);
    } else {
      await database
        .prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('original_141_283_duplicate_fixes_v2_error',?)")
        .bind(errors.join(" | ").slice(0, 1800))
        .run();
      console.error("Original 141-283 duplicate photo fixes v2 incomplete", errors);
    }
  }

  // Visual audit of the original 141-283 assignment (admin pages 8+).
  // Pages 1-7 are intentionally excluded because the user already cleaned those manually.
  const original141283VisualCorrectionsV1 = await database
    .prepare("SELECT value FROM app_settings WHERE key='original_141_283_visual_corrections_v1'")
    .first<{ value: string }>();
  if (original141283VisualCorrectionsV1?.value !== "1") {
    const corrections: PhotoImportEntry[] = [
      {
        // The old image showed whole croakers even though this SKU is a fillet.
        key: "catalog-original-148-croaker-fillet.webp",
        sourceUrl: "https://thumbnail.coupangcdn.com/thumbnails/remote/657x657q90trim/image/vendor_inventory/image_audit/stage/manual/9fc6dd70cb754a80f695d2d0c696957fad5875d398c1a88494ccb3d57ba4_1756098202522.jpg",
        productIds: ["ERP-32409"],
      },
      {
        // These /절단 SKUs were sharing whole salted-mackerel photos.
        key: "catalog-original-cut-jaban-mackerel.webp",
        sourceUrl: "https://m.gorebob.com/web/product/extra/big/201905/ea4bce31cc53051e11244e3de553d7c8.jpg",
        productIds: ["ERP-30634", "ERP-32440"],
      },
      {
        // The old three images were generic distributor placeholder shots.
        key: "catalog-original-cleaned-baby-octopus.webp",
        sourceUrl: "https://gi.esmplus.com/jjang55490/%EC%97%B0%EC%B2%B4%EB%A5%98/pro_%EC%AD%88%EA%BE%B8%EB%AF%B8200g_01.png",
        productIds: ["ERP-32644", "ERP-30986", "ERP-32781"],
      },
      {
        // This 900 g shrimp SKU was using a visibly 200 g pack image.
        key: "catalog-original-182-cocktail-shrimp-900g.webp",
        sourceUrl: "https://s3.ap-northeast-2.amazonaws.com/gred/vendor/1653/images/39_1661329203.jpg",
        productIds: ["ERP-32016"],
      },
      {
        // Raw pork strips are more accurate than the cooked japchae dish that was shown.
        key: "catalog-original-216-pork-strips.webp",
        sourceUrl: "https://m.xn--299ayyo6jh9g9pm93g.kr/web/product/extra/big/202406/537eedf33b459583b28430fd567ef46b.jpg",
        productIds: ["ERP-31040"],
      },
      {
        // 소불고기헤드 is head meat; the old photo was a bottle of bulgogi marinade.
        key: "catalog-original-222-beef-head-meat.webp",
        sourceUrl: "https://gdimg.gmarket.co.kr/3133257833/more/02/800?ver=177396",
        productIds: ["ERP-32766"],
      },
    ];

    const correctionErrors: string[] = [];
    for (const correction of corrections) {
      try {
        const existingIds: string[] = [];
        for (const id of correction.productIds) {
          const existing = await database.prepare("SELECT id FROM products WHERE id=?").bind(id).first<{ id: string }>();
          if (existing?.id) existingIds.push(id);
        }
        if (!existingIds.length) continue;
        await importPhotoEntry({ ...correction, productIds: existingIds });
      } catch (error) {
        correctionErrors.push(
          `${correction.productIds.join(",")}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (correctionErrors.length === 0) {
      await database.batch([
        database.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('original_141_283_visual_corrections_v1','1')"),
        database.prepare("DELETE FROM app_settings WHERE key='original_141_283_visual_corrections_v1_error'"),
      ]);
    } else {
      await database
        .prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('original_141_283_visual_corrections_v1_error',?)")
        .bind(correctionErrors.join(" | ").slice(0, 1800))
        .run();
      console.error("Original 141-283 visual corrections incomplete", correctionErrors);
    }
  }

  // Admin page 26: non-Claude live products only; audited targets were blank.
  const adminPage26ExtraPhotoCorrectionsV1 = await database
    .prepare("SELECT value FROM app_settings WHERE key='admin_page26_extra_photo_corrections_v1'")
    .first<{ value: string }>();
  if (adminPage26ExtraPhotoCorrectionsV1?.value !== "1") {
    const fixes: Array<PhotoImportEntry & { expectedPhoto: string }> = [
      {
        key: "catalog-admin-page26-501-erp-32387.webp",
        sourceUrl: "https://www.costco.co.kr/medias/sys_master/images/h53/h92/244003528769566.jpg",
        productIds: ["ERP-32387"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page26-502-erp-32589.webp",
        sourceUrl: "https://m.nongshimmall.com/web/product/big/202603/59b06e318bd8aa11e6cc01bb9cdd26a1.jpg",
        productIds: ["ERP-32589"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page26-503-erp-32571.webp",
        sourceUrl: "https://asset.m-gs.kr/prod/1037708219/1/550",
        productIds: ["ERP-32571"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page26-505-erp-32975.webp",
        sourceUrl: "https://m.nongshimmall.com/web/product/medium/202512/b3623c0492e8beeb51c6c206acd2eaa8.jpg",
        productIds: ["ERP-32975"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page26-506-erp-32856.webp",
        sourceUrl: "https://asset.m-gs.kr/prod/1007529748/1/550",
        productIds: ["ERP-32856"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page26-507-erp-30150.webp",
        sourceUrl: "https://m.nongshimmall.com/web/product/big/202511/660c92964a2b0a983537f8110dc3d54f.jpg",
        productIds: ["ERP-30150"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page26-508-erp-31878.webp",
        sourceUrl: "https://image.homeplus.kr/td/5a765be8-d659-406c-aa96-4be9d93b9c8b",
        productIds: ["ERP-31878"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page26-510-erp-32965.webp",
        sourceUrl: "https://image2.lotteimall.com/goods/74/90/63/2799639074_3.jpg/dims/resizemc/550x550/optimize",
        productIds: ["ERP-32965"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page26-511-erp-33022.webp",
        sourceUrl: "https://m.iworldstar.com/web/product/big/202404/bc0320a9ddfbd06896219109dfceab57.jpg",
        productIds: ["ERP-33022"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page26-514-erp-32388.webp",
        sourceUrl: "https://thumbnail.coupangcdn.com/thumbnails/remote/492x492ex/image/vendor_inventory/e20c/146d0205b001c8d73a2403997c0ba3c02909c285b644b26b6e6df226d587.png",
        productIds: ["ERP-32388"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page26-515-erp-30422.webp",
        sourceUrl: "https://image.8dogam.com/resized/product/review/v1/upload/ba9b2774db8e48a6b7ba1625da1d7725.jpg?ext=jpg&res=3x&type=small",
        productIds: ["ERP-30422"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page26-517-erp-31883.webp",
        sourceUrl: "https://image.homeplus.kr/rtd/02912309-4f07-40ce-aca1-fdf1fc1287cc?w=750",
        productIds: ["ERP-31883"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page26-518-erp-32869.webp",
        sourceUrl: "https://m.nongshimmall.com/web/product/big/202407/a2075cd0522540af5d9cf1de692382e5.jpg",
        productIds: ["ERP-32869"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page26-520-erp-32982.webp",
        sourceUrl: "https://thumbnail8.coupangcdn.com/thumbnails/remote/492x492ex/image/retail/images/91023087552009-9eccc0aa-152f-41bd-a84d-c42d52a748cc.jpg",
        productIds: ["ERP-32982"],
        expectedPhoto: "",
      },
    ];

    const errors: string[] = [];
    for (const fix of fixes) {
      const id = fix.productIds[0] || "";
      const existing = id
        ? await database.prepare("SELECT photo FROM products WHERE id=?").bind(id).first<{ photo: string }>()
        : null;
      if (!existing || String(existing.photo || "") !== fix.expectedPhoto) continue;
      try {
        await importPhotoEntry(fix);
      } catch (error) {
        errors.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (errors.length === 0) {
      await database.batch([
        database.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('admin_page26_extra_photo_corrections_v1','1')"),
        database.prepare("DELETE FROM app_settings WHERE key='admin_page26_extra_photo_corrections_v1_error'"),
      ]);
    } else {
      await database
        .prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('admin_page26_extra_photo_corrections_v1_error',?)")
        .bind(errors.join(" | ").slice(0, 1800))
        .run();
      console.error("Admin page 26 extra photo corrections incomplete", errors);
    }
  }

  // Admin pages 23-25: non-Claude live products only.
  // Two ambiguous internal rice-cake names (ERP-30622, ERP-30639) are intentionally left blank.
  const adminPages2325ExtraPhotoCorrectionsV1 = await database
    .prepare("SELECT value FROM app_settings WHERE key='admin_pages23_25_extra_photo_corrections_v1'")
    .first<{ value: string }>();
  if (adminPages2325ExtraPhotoCorrectionsV1?.value !== "1") {
    const fixes: Array<PhotoImportEntry & { expectedPhoto: string }> = [
      {
        key: "catalog-admin-page23-441-erp-31486.webp",
        sourceUrl: "https://img.cjthemarket.com/images/file/product/20260204/700_124700_1.jpg",
        productIds: ["ERP-31486"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page23-444-erp-30382.webp",
        sourceUrl: "https://oasisprodproduct.edge.naverncp.com/2924/detail/1_28d8f8e1-667a-4569-8712-49cedf9df216.jpg",
        productIds: ["ERP-30382"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page23-448-erp-31736.webp",
        sourceUrl: "https://thumbnail.coupangcdn.com/thumbnails/remote/492x492ex/image/vendor_inventory/20d1/18b241a3b5596c338b58b51fb5483703bac9f34bd0a1d29bda84074cdcc5.jpeg",
        productIds: ["ERP-31736"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page23-457-erp-31471.webp",
        sourceUrl: "https://m.josundal.com/web/product/big/202110/84eca47508743bbae19249191856c2c2.jpg",
        productIds: ["ERP-31471"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page24-470-erp-33003.webp",
        sourceUrl: "https://oasisprodproduct.edge.naverncp.com/47331/detail/detail_47331_2_0e5f435f-89ce-4bac-927a-f46649b3e828.png",
        productIds: ["ERP-33003"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page24-474-erp-32792.webp",
        sourceUrl: "https://img1.kakaocdn.net/thumb/P750x750%401.5x.fwebp.q82/?fname=https%3A%2F%2Fst.kakaocdn.net%2Fshoppingstore%2Fproduct%2F20251128165118_f3bedb268cf949778cecd590f687201a.png",
        productIds: ["ERP-32792"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page24-475-erp-32804.webp",
        sourceUrl: "https://cimg.cowave.kr/image/vendor_inventory/e543/4f187ead75fb4b6fd7fb5a0fcf54fbb90238017790d3be7cd67b7ece89c9.jpg",
        productIds: ["ERP-32804"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page24-479-erp-31452.webp",
        sourceUrl: "https://thumbnail.coupangcdn.com/thumbnails/remote/492x492ex/image/vendor_inventory/e4f2/18f7fa6b0f5ad9225571f4a4fae448fd630b583c1198004c98f898630d4c.jpg",
        productIds: ["ERP-31452"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page25-481-erp-31323.webp",
        sourceUrl: "https://img.danawa.com/prod_img/500000/951/973/img/6973951_1.jpg?_v=20190621122037",
        productIds: ["ERP-31323"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page25-484-erp-32068.webp",
        sourceUrl: "https://image.coupangcdn.com/image/vendor_inventory/24d8/932d48a65ec9b5c25046618077b72a9545c85eee1ee3548023a14aaa2903.jpg",
        productIds: ["ERP-32068"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page25-485-erp-20001.webp",
        sourceUrl: "https://img.danawa.com/prod_img/500000/968/909/img/99909968_1.jpg?_v=20260326172516",
        productIds: ["ERP-20001"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page25-494-erp-32905.webp",
        sourceUrl: "https://shop-phinf.pstatic.net/20230112_98/16734853614001FvzD_JPEG/SE-2b550ff7-8996-41f7-81d8-563e533365f6.jpg?type=w860",
        productIds: ["ERP-32905"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page25-495-erp-32174.webp",
        sourceUrl: "https://thumbnail.coupangcdn.com/thumbnails/remote/492x492ex/image/vendor_inventory/72c9/beb9f3693e515b3b57a494c35d74d0e22c268d9b69e6a1614af03a702c65.png",
        productIds: ["ERP-32174"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page25-498-erp-30239.webp",
        sourceUrl: "https://www.costco.co.kr/medias/sys_master/images/hc5/h29/386955082170398.jpg",
        productIds: ["ERP-30239"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page25-499-erp-32947.webp",
        sourceUrl: "https://shop.r10s.jp/iitokoshop/cabinet/biiino/item/main-image-3/1705377987179_1.jpg",
        productIds: ["ERP-32947"],
        expectedPhoto: "",
      },
    ];

    const errors: string[] = [];
    for (const fix of fixes) {
      const id = fix.productIds[0] || "";
      const existing = id
        ? await database.prepare("SELECT photo FROM products WHERE id=?").bind(id).first<{ photo: string }>()
        : null;
      if (!existing || String(existing.photo || "") !== fix.expectedPhoto) continue;
      try {
        await importPhotoEntry(fix);
      } catch (error) {
        errors.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (errors.length === 0) {
      await database.batch([
        database.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('admin_pages23_25_extra_photo_corrections_v1','1')"),
        database.prepare("DELETE FROM app_settings WHERE key='admin_pages23_25_extra_photo_corrections_v1_error'"),
      ]);
    } else {
      await database
        .prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('admin_pages23_25_extra_photo_corrections_v1_error',?)")
        .bind(errors.join(" | ").slice(0, 1800))
        .run();
      console.error("Admin pages 23-25 extra photo corrections incomplete", errors);
    }
  }

  // Admin pages 20-22: non-Claude live products only; all targets were blank at audit time.
  const adminPages2022ExtraPhotoCorrectionsV1 = await database
    .prepare("SELECT value FROM app_settings WHERE key='admin_pages20_22_extra_photo_corrections_v1'")
    .first<{ value: string }>();
  if (adminPages2022ExtraPhotoCorrectionsV1?.value !== "1") {
    const fixes: Array<PhotoImportEntry & { expectedPhoto: string }> = [
      {
        key: "catalog-admin-page20-381-erp-31521.webp",
        sourceUrl: "https://gagopahealingfood.co.kr/data/goods/1/2021/09/268_temp_16323621834668view.jpg",
        productIds: ["ERP-31521"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page20-382-erp-32266.webp",
        sourceUrl: "https://img.danawa.com/prod_img/500000/274/567/img/4567274_1.jpg?_v=20170622172214",
        productIds: ["ERP-32266"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page20-383-erp-31524.webp",
        sourceUrl: "https://shop4.daumcdn.net/thumb/R500x500/?fname=http%3A%2F%2Fshop4.daumcdn.net%2Fshophow%2Fp%2FW5577870773.jpg%3Fut%3D20251126205440",
        productIds: ["ERP-31524"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page20-385-erp-31931.webp",
        sourceUrl: "https://asset.m-gs.kr/prod/1034841131/1/550",
        productIds: ["ERP-31931"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page20-388-erp-2008.webp",
        sourceUrl: "https://thumbnail.coupangcdn.com/thumbnails/remote/492x492ex/image/vendor_inventory/4090/2ab349dc8f9c27b090992c2d6ba9915994359cfff5d1fdba2fc5627058f7.jpg",
        productIds: ["ERP-2008"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page21-403-erp-30435.webp",
        sourceUrl: "https://baking25.com/web/product/big/shop1_30da1ff9c0f0b8a019c2305f83d1da18.jpg",
        productIds: ["ERP-30435"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page21-407-erp-32985.webp",
        sourceUrl: "https://asset.m-gs.kr/prod/22976687/1/550",
        productIds: ["ERP-32985"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page21-412-erp-32168.webp",
        sourceUrl: "https://m.wellbaking.com/web/product/big/202508/fea0482686b845bc61ecce56a2cd6540.jpg",
        productIds: ["ERP-32168"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page21-413-erp-31467.webp",
        sourceUrl: "https://fastmall.co.kr/web/product/small/202604/e4a848de30a0aef089edf7631de4a517.jpg",
        productIds: ["ERP-31467"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page21-417-erp-8108.webp",
        sourceUrl: "https://gamarang.com/web/product/big/202602/aac7b88703475643aa2e6bf745ff3991.jpg",
        productIds: ["ERP-8108"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page21-419-erp-32981.webp",
        sourceUrl: "https://sitem.ssgcdn.com/30/27/66/item/1000624662730_i1_500.jpg",
        productIds: ["ERP-32981"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page22-424-erp-32560.webp",
        sourceUrl: "https://shop2.daumcdn.net/shophow/p/D5256289501.jpg?opt=R500x500.q90&type=thumb&ut=20260303162027",
        productIds: ["ERP-32560"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page22-428-erp-32830.webp",
        sourceUrl: "https://contents.lotteon.com/itemimage/20251103111659/LO/23/28/76/38/45/_2/32/87/63/84/6/LO2328763845_2328763846_4.jpg/dims/optimize/resizemc/400x400",
        productIds: ["ERP-32830"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page22-432-erp-32322.webp",
        sourceUrl: "https://image.homeplus.kr/rtd/e80dfc06-9e7d-47e1-9449-961733091733?w=750",
        productIds: ["ERP-32322"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page22-433-erp-31828.webp",
        sourceUrl: "https://contents.lotteon.com/itemimage/20251108180359/LO/25/73/46/13/95/_2/57/34/61/39/6/LO2573461395_2573461396_1.jpg/dims/optimize/resizemc/400x400",
        productIds: ["ERP-31828"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page22-434-erp-30581.webp",
        sourceUrl: "https://static.chabyulhwa.com/products/images/raw/202504/%ED%86%B5%ED%9B%84%EC%B6%94_8ce1d205-0d30-4441-ba83-604f9ff15785.png",
        productIds: ["ERP-30581"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page22-437-erp-32986.webp",
        sourceUrl: "https://img.danawa.com/prod_img/500000/497/748/img/11748497_1.jpg?_v=20200707111659",
        productIds: ["ERP-32986"],
        expectedPhoto: "",
      },
    ];

    const errors: string[] = [];
    for (const fix of fixes) {
      const id = fix.productIds[0] || "";
      const existing = id
        ? await database.prepare("SELECT photo FROM products WHERE id=?").bind(id).first<{ photo: string }>()
        : null;
      if (!existing || String(existing.photo || "") !== fix.expectedPhoto) continue;
      try {
        await importPhotoEntry(fix);
      } catch (error) {
        errors.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (errors.length === 0) {
      await database.batch([
        database.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('admin_pages20_22_extra_photo_corrections_v1','1')"),
        database.prepare("DELETE FROM app_settings WHERE key='admin_pages20_22_extra_photo_corrections_v1_error'"),
      ]);
    } else {
      await database
        .prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('admin_pages20_22_extra_photo_corrections_v1_error',?)")
        .bind(errors.join(" | ").slice(0, 1800))
        .run();
      console.error("Admin pages 20-22 extra photo corrections incomplete", errors);
    }
  }

  // Admin pages 17-19: fill only live products that are NOT in Claude's 284-566 ERP list.
  // All audited targets were blank. A user's manual upload always wins because the import
  // runs only while the current photo is still exactly the audited empty string.
  const adminPages1719ExtraPhotoCorrectionsV1 = await database
    .prepare("SELECT value FROM app_settings WHERE key='admin_pages17_19_extra_photo_corrections_v1'")
    .first<{ value: string }>();
  if (adminPages1719ExtraPhotoCorrectionsV1?.value !== "1") {
    const fixes: Array<PhotoImportEntry & { expectedPhoto: string }> = [
      {
        key: "catalog-admin-page17-321-erp-32575.webp",
        sourceUrl: "https://www.sajofoodist.co.kr/product_img/8809627599247.jpg",
        productIds: ["ERP-32575"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page17-324-erp-31388.webp",
        sourceUrl: "https://baking25.com/web/product/big/shop1_0b54101873caecfeaada1fdb2d2f9e41.JPG",
        productIds: ["ERP-31388"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page17-329-erp-32275.webp",
        sourceUrl: "https://cdn.imweb.me/thumbnail/20211226/ec66d45e909be.jpg",
        productIds: ["ERP-32275"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page17-330-erp-30495.webp",
        sourceUrl: "https://m.food-k.co.kr/web/product/big/202103/479d27516390c5470d32cc17597a2f14.jpg",
        productIds: ["ERP-30495"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page17-331-erp-32992.webp",
        sourceUrl: "https://thumbnail.coupangcdn.com/thumbnails/remote/492x492ex/image/retail/images/263861063762405-5cfa48a9-8629-4033-8724-07b1caf76c12.jpg",
        productIds: ["ERP-32992"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page17-333-erp-30223.webp",
        sourceUrl: "https://shop-phinf.pstatic.net/20230503_212/1683118138150QNGLu_JPEG/KakaoTalk_20230503_205319502.jpg?type=w860",
        productIds: ["ERP-30223"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page18-341-erp-32968.webp",
        sourceUrl: "https://ecimg.cafe24img.com/pg495b91623015012/saucelab/web/product/big/20231012/4b31a607b31480c232a2abda7701c32d.png",
        productIds: ["ERP-32968"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page18-342-erp-32600.webp",
        sourceUrl: "https://makeshop-multi-images.akamaized.net/nakayamafood/itemimages/000000001133_FuFzoUt.jpg",
        productIds: ["ERP-32600"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page18-355-erp-31460.webp",
        sourceUrl: "https://shop.bellfoods.co.jp/cdn/shop/files/142781965.jpg?v=1724834078&width=550",
        productIds: ["ERP-31460"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page18-356-erp-32810.webp",
        sourceUrl: "https://s3.ap-northeast-2.amazonaws.com/gred/vendor/1517/images/17_4314350619_r.jpg",
        productIds: ["ERP-32810"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page18-357-erp-32941.webp",
        sourceUrl: "https://m.withmeat1201.com/web/product/big/202104/707fe610b5e6d6c8bc7f1d4cff6d9249.jpg",
        productIds: ["ERP-32941"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page18-359-erp-31391.webp",
        sourceUrl: "https://foodtalktalk.com/web/product/images/wstory/2025/06/0060/1000782098_00_0.jpg",
        productIds: ["ERP-31391"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page18-360-erp-31571.webp",
        sourceUrl: "https://st.kakaocdn.net/shoppingstore/product/20260329155612_5a6d0c3c76a14353913002aec1f498be.jpg",
        productIds: ["ERP-31571"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page19-361-erp-32483.webp",
        sourceUrl: "https://m.splusmarket.com/web/product/extra/big/202407/ab684386d41f45542a9443d4b0720ac9.jpg",
        productIds: ["ERP-32483"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page19-364-erp-32885.webp",
        sourceUrl: "https://content.foodspring.co.kr/vendor/1769/images/75_6131247999_r.jpg",
        productIds: ["ERP-32885"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page19-374-erp-31871.webp",
        sourceUrl: "https://images.emarteveryday.co.kr/images/productreview/SQI3tNFFAwtasvgP/SglP8Db7CghCEGsN.jpg",
        productIds: ["ERP-31871"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page19-375-erp-32914.webp",
        sourceUrl: "https://godomall.speedycdn.net/71b53f11bc182bb6fe531a760f3a2a00/goods/1000000289/image/detail/1000000289_detail_078.jpg",
        productIds: ["ERP-32914"],
        expectedPhoto: "",
      },
    ];

    const errors: string[] = [];
    for (const fix of fixes) {
      const id = fix.productIds[0] || "";
      const existing = id
        ? await database.prepare("SELECT photo FROM products WHERE id=?").bind(id).first<{ photo: string }>()
        : null;
      if (!existing || String(existing.photo || "") !== fix.expectedPhoto) continue;
      try {
        await importPhotoEntry(fix);
      } catch (error) {
        errors.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (errors.length === 0) {
      await database.batch([
        database.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('admin_pages17_19_extra_photo_corrections_v1','1')"),
        database.prepare("DELETE FROM app_settings WHERE key='admin_pages17_19_extra_photo_corrections_v1_error'"),
      ]);
    } else {
      await database
        .prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('admin_pages17_19_extra_photo_corrections_v1_error',?)")
        .bind(errors.join(" | ").slice(0, 1800))
        .run();
      console.error("Admin pages 17-19 extra photo corrections incomplete", errors);
    }
  }

  // Admin product page 16: only fill products not present in Claude's 284-566 assignment.
  // All five were blank in the live audit; a manual user upload made after the audit wins.
  const adminPage16PhotoCorrectionsV1 = await database
    .prepare("SELECT value FROM app_settings WHERE key='admin_page16_photo_corrections_v1'")
    .first<{ value: string }>();
  if (adminPage16PhotoCorrectionsV1?.value !== "1") {
    const fixes: Array<PhotoImportEntry & { expectedPhoto: string }> = [
      {
        key: "catalog-admin-page16-301-erp-32219.webp",
        sourceUrl: "https://img-cf.kurly.com/hdims/resize/%3E1010x/quality/90/src/shop/data/goodsview/20240417/gv10000816448_1.jpg",
        productIds: ["ERP-32219"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page16-309-erp-32999.webp",
        sourceUrl: "https://m.jiwonfoodmall.com/web/upload/NNEditor/20250325/ab216a8498e3fff4108efa55ff05b627.jpg",
        productIds: ["ERP-32999"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page16-312-erp-31552.webp",
        sourceUrl: "https://fastmall.co.kr/web/product/small/202509/32dea29a857f25614559cc141d7b96bb.jpg",
        productIds: ["ERP-31552"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page16-314-erp-32743.webp",
        sourceUrl: "https://img.danawa.com/prod_img/500000/005/085/img/17085005_1.jpg?_v=20250919061330&shrink=360%3A360",
        productIds: ["ERP-32743"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page16-320-erp-31886.webp",
        sourceUrl: "https://gi.esmplus.com/food0077/food007/%EB%8C%80%EC%83%81/%EB%8C%80%EC%83%81%20%EC%89%90%ED%94%84%EC%9B%90%20%EB%96%A1%EB%B3%B6%EC%9D%B4%EC%86%8C%EC%8A%A4%2010kg.jpg",
        productIds: ["ERP-31886"],
        expectedPhoto: "",
      },
    ];

    const errors: string[] = [];
    for (const fix of fixes) {
      const id = fix.productIds[0] || "";
      const existing = id
        ? await database.prepare("SELECT photo FROM products WHERE id=?").bind(id).first<{ photo: string }>()
        : null;
      if (!existing || String(existing.photo || "") !== fix.expectedPhoto) continue;
      try {
        await importPhotoEntry(fix);
      } catch (error) {
        errors.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (errors.length === 0) {
      await database.batch([
        database.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('admin_page16_photo_corrections_v1','1')"),
        database.prepare("DELETE FROM app_settings WHERE key='admin_page16_photo_corrections_v1_error'"),
      ]);
    } else {
      await database
        .prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('admin_page16_photo_corrections_v1_error',?)")
        .bind(errors.join(" | ").slice(0, 1800))
        .run();
      console.error("Admin page 16 photo corrections incomplete", errors);
    }
  }

  // Admin product page 15 (live rows 281-300 on 2026-10-26).
  // Pages 1-14 are protected because the user manually reviewed them.
  // Each fix is guarded by the exact photo seen during the live audit so a concurrent
  // manual upload always wins and is never overwritten by this migration.
  const adminPage15PhotoCorrectionsV1 = await database
    .prepare("SELECT value FROM app_settings WHERE key='admin_page15_photo_corrections_v1'")
    .first<{ value: string }>();
  if (adminPage15PhotoCorrectionsV1?.value !== "1") {
    const fixes: Array<PhotoImportEntry & { expectedPhoto: string }> = [
      {
        key: "catalog-admin-page15-281-erp-30933.webp",
        sourceUrl: "https://content.foodspring.co.kr/vendor/93/images/85_2752018228_r.jpg?f=webp&s=876x876&t=inside",
        productIds: ["ERP-30933"],
        expectedPhoto: "/api/photo?id=catalog-a78f6139253cf56339b5.webp",
      },
      {
        key: "catalog-admin-page15-283-erp-8024.webp",
        sourceUrl: "https://m.seoilfnb.com/web/product/big/108863/1088637ZmU66464Kp7J6R64u566m01kg_1.JPG",
        productIds: ["ERP-8024"],
        expectedPhoto: "/api/photo?id=catalog-search-erp-8024.webp",
      },
      {
        key: "catalog-admin-page15-287-erp-30286.webp",
        sourceUrl: "https://img-cf.kurly.com/hdims/resize/%3E720x/quality/90/src/shop/data/goodsview/20200331/gv00000088227_1.jpg",
        productIds: ["ERP-30286"],
        expectedPhoto: "/api/photo?id=catalog-current283-erp-30286.webp",
      },
      {
        key: "catalog-admin-page15-289-erp-8051.webp",
        sourceUrl: "https://fastmall.co.kr/web/product/big/202509/bc0b1c86f657ea4f921cffe4344b98b8.jpg",
        productIds: ["ERP-8051"],
        expectedPhoto: "/api/photo?id=catalog-search-erp-8051.webp",
      },
      {
        key: "catalog-admin-page15-290-erp-8053.webp",
        sourceUrl: "https://content.foodspring.co.kr/vendor/1388/images/410_6681075817.jpg",
        productIds: ["ERP-8053"],
        expectedPhoto: "/api/photo?id=catalog-search-erp-8053.webp",
      },
      {
        key: "catalog-admin-page15-291-erp-32956.webp",
        sourceUrl: "https://thumbnail.coupangcdn.com/thumbnails/remote/492x492ex/image/retail/images/2025/09/11/11/9/d1df1dae-81c7-4da0-a824-8db1cadb43d9.jpg",
        productIds: ["ERP-32956"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page15-293-erp-32032.webp",
        sourceUrl: "https://cdn.imweb.me/thumbnail/20210912/2da6157027a8e.png",
        productIds: ["ERP-32032"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page15-294-erp-31325.webp",
        sourceUrl: "https://ecimg.cafe24img.com/pg707b04087142059/parado99/web/product/big/20240809/bd7288a81eb7948bc8a697e5198e1f2e.jpg",
        productIds: ["ERP-31325"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page15-295-erp-32926.webp",
        sourceUrl: "https://sehyeon.s3.us-east-2.amazonaws.com/004460.jpg",
        productIds: ["ERP-32926"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page15-296-erp-31873.webp",
        sourceUrl: "https://thumbnail.coupangcdn.com/thumbnails/remote/492x492ex/image/vendor_inventory/01dc/db621ee784dc6aef0d2e59ae33919d555ea90d23497214de5d87875d84cd.jpg",
        productIds: ["ERP-31873"],
        expectedPhoto: "",
      },
      {
        key: "catalog-admin-page15-297-erp-32959.webp",
        sourceUrl: "https://sitem.ssgcdn.com/09/10/64/item/1000732641009_i1_500.jpg",
        productIds: ["ERP-32959"],
        expectedPhoto: "",
      },
    ];

    const errors: string[] = [];
    for (const fix of fixes) {
      const id = fix.productIds[0] || "";
      const existing = id
        ? await database.prepare("SELECT photo FROM products WHERE id=?").bind(id).first<{ photo: string }>()
        : null;
      if (!existing || String(existing.photo || "") !== fix.expectedPhoto) continue;
      try {
        await importPhotoEntry(fix);
      } catch (error) {
        errors.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (errors.length === 0) {
      await database.batch([
        database.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('admin_page15_photo_corrections_v1','1')"),
        database.prepare("DELETE FROM app_settings WHERE key='admin_page15_photo_corrections_v1_error'"),
      ]);
    } else {
      await database
        .prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('admin_page15_photo_corrections_v1_error',?)")
        .bind(errors.join(" | ").slice(0, 1800))
        .run();
      console.error("Admin page 15 photo corrections incomplete", errors);
    }
  }

  const photoAutofillParserV2 = await database
    .prepare("SELECT value FROM app_settings WHERE key='photo_autofill_parser_v2'")
    .first<{ value: string }>();
  if (photoAutofillParserV2?.value !== "1") {
    await database.batch([
      database.prepare("DELETE FROM app_settings WHERE key='photo_autofill_v1_skipped'"),
      database.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('photo_autofill_parser_v2','1')"),
    ]);
  }

  const sellingFixed = await database
    .prepare("SELECT value FROM app_settings WHERE key='erp_products_selling_v1'")
    .first<{ value: string }>();
  if (sellingFixed?.value !== "1") {
    await database.batch([
      database.prepare("UPDATE products SET hidden=0, soldout=0, price_list_visible=1 WHERE id LIKE 'ERP-%'"),
      database.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('erp_products_selling_v1','1')"),
    ]);
  }
}

export const Route = createFileRoute("/api/store")({
  server: { handlers: { GET: async ({ request }) => {
    try {
      const url = new URL(request.url);
      await ensureCatalogImportV3();

      if (url.searchParams.get("visual141283PhotoStatus") === "1") {
        const database = db();
        const ids = ["ERP-32409","ERP-30634","ERP-32440","ERP-32644","ERP-30986","ERP-32781","ERP-32016","ERP-31040","ERP-32766"];
        const placeholders = ids.map(() => "?").join(",");
        const [rows, doneRow, errorRow] = await Promise.all([
          database.prepare(`SELECT id,name,photo,sort_order FROM products WHERE id IN (${placeholders}) ORDER BY sort_order,name`).bind(...ids).all(),
          database.prepare("SELECT value FROM app_settings WHERE key='original_141_283_visual_corrections_v1'").first<{ value: string }>(),
          database.prepare("SELECT value FROM app_settings WHERE key='original_141_283_visual_corrections_v1_error'").first<{ value: string }>(),
        ]);
        return Response.json({
          visual141283PhotoStatus: true,
          done: doneRow?.value === "1",
          error: errorRow?.value || "",
          products: rows.results,
        });
      }

      if (url.searchParams.get("current283PhotoStatus") === "1") {
        const database = db();
        const ids = ["ERP-32199","ERP-31586","ERP-5003","ERP-5004","ERP-32843","ERP-32154","ERP-30436","ERP-30124","ERP-31373","ERP-32878"];
        const placeholders = ids.map(() => "?").join(",");
        const [rows, doneRow, errorRow] = await Promise.all([
          database.prepare(`SELECT id,name,photo,sort_order FROM products WHERE id IN (${placeholders}) ORDER BY sort_order,name`).bind(...ids).all(),
          database.prepare("SELECT value FROM app_settings WHERE key='current_283_photo_corrections_v1'").first<{ value: string }>(),
          database.prepare("SELECT value FROM app_settings WHERE key='current_283_photo_corrections_v1_error'").first<{ value: string }>(),
        ]);
        return Response.json({
          current283PhotoStatus: true,
          done: doneRow?.value === "1",
          error: errorRow?.value || "",
          products: rows.results,
        }, { headers: { "Cache-Control": "no-store" } });
      }

      if (url.searchParams.get("page10PhotoStatus") === "1") {
        const database = db();
        const ids = ["ERP-33023","ERP-33024","ERP-32439","ERP-32665","ERP-32468","ERP-32192","ERP-31895","ERP-32780","ERP-32195"];
        const placeholders = ids.map(() => "?").join(",");
        const [rows, doneRow, errorRow] = await Promise.all([
          database.prepare(`SELECT id,name,photo,sort_order FROM products WHERE id IN (${placeholders}) ORDER BY sort_order,name`).bind(...ids).all(),
          database.prepare("SELECT value FROM app_settings WHERE key='page10_photo_corrections_v1'").first<{ value: string }>(),
          database.prepare("SELECT value FROM app_settings WHERE key='page10_photo_corrections_v1_error'").first<{ value: string }>(),
        ]);
        return Response.json({
          page10CorrectionStatus: true,
          done: doneRow?.value === "1",
          error: errorRow?.value || "",
          products: rows.results,
        }, { headers: { "Cache-Control": "no-store" } });
      }

      if (url.searchParams.get("page9PhotoStatus") === "1") {
        const database = db();
        const ids = ["ERP-32370","ERP-32225","ERP-32786"];
        const placeholders = ids.map(() => "?").join(",");
        const [rows, doneRow, errorRow] = await Promise.all([
          database.prepare(`SELECT id,name,photo,sort_order FROM products WHERE id IN (${placeholders}) ORDER BY sort_order,name`).bind(...ids).all(),
          database.prepare("SELECT value FROM app_settings WHERE key='page9_photo_corrections_v1'").first<{ value: string }>(),
          database.prepare("SELECT value FROM app_settings WHERE key='page9_photo_corrections_v1_error'").first<{ value: string }>(),
        ]);
        return Response.json({
          page9CorrectionStatus: true,
          done: doneRow?.value === "1",
          error: errorRow?.value || "",
          products: rows.results,
        }, { headers: { "Cache-Control": "no-store" } });
      }

      if (url.searchParams.get("page8PhotoStatus") === "1") {
        const database = db();
        const ids = ["ERP-32829","ERP-32832","ERP-31351","ERP-31410","ERP-32478","ERP-32852","ERP-1063"];
        const placeholders = ids.map(() => "?").join(",");
        const [rows, doneRow, errorRow, doneV2Row, errorV2Row] = await Promise.all([
          database.prepare(`SELECT id,name,photo,sort_order FROM products WHERE id IN (${placeholders}) ORDER BY sort_order,name`).bind(...ids).all(),
          database.prepare("SELECT value FROM app_settings WHERE key='page8_photo_corrections_v1'").first<{ value: string }>(),
          database.prepare("SELECT value FROM app_settings WHERE key='page8_photo_corrections_v1_error'").first<{ value: string }>(),
          database.prepare("SELECT value FROM app_settings WHERE key='page8_photo_corrections_v2'").first<{ value: string }>(),
          database.prepare("SELECT value FROM app_settings WHERE key='page8_photo_corrections_v2_error'").first<{ value: string }>(),
        ]);
        return Response.json({
          page8CorrectionStatus: true,
          done: doneRow?.value === "1" && doneV2Row?.value === "1",
          error: [errorRow?.value || "", errorV2Row?.value || ""].filter(Boolean).join(" | "),
          products: rows.results,
        }, { headers: { "Cache-Control": "no-store" } });
      }

      if (url.searchParams.get("catalogPhotoReviewAll") === "1") {
        const database = db();
        const rows = await database
          .prepare("SELECT id,name,category,sub,unit,photo,sort_order FROM products ORDER BY sort_order,name")
          .all();
        return Response.json({
          catalogPhotoReviewAll: true,
          total: rows.results.length,
          products: rows.results,
        }, { headers: { "Cache-Control": "no-store" } });
      }

      if (url.searchParams.get("catalogPhotoReview") === "1") {
        const database = db();
        const page = Math.max(1, Math.floor(Number(url.searchParams.get("page") || "1")));
        const pageSize = 20;
        const offset = (page - 1) * pageSize;
        const [countRow, rows] = await Promise.all([
          database.prepare("SELECT COUNT(*) AS count FROM products").first<{ count: number }>(),
          database
            .prepare("SELECT id,name,category,sub,unit,photo,sort_order FROM products ORDER BY sort_order,name LIMIT ? OFFSET ?")
            .bind(pageSize, offset)
            .all(),
        ]);
        const total = Number(countRow?.count ?? 0);
        return Response.json({
          catalogPhotoReview: true,
          page,
          pageSize,
          total,
          pages: Math.max(1, Math.ceil(total / pageSize)),
          startIndex: offset + 1,
          endIndex: Math.min(total, offset + pageSize),
          products: rows.results,
        }, { headers: { "Cache-Control": "no-store" } });
      }

      if (url.searchParams.get("page15CorrectionStatus") === "1") {
        const database = db();
        const ids = ["ERP-30933","ERP-8024","ERP-30286","ERP-8051","ERP-8053","ERP-32956","ERP-32032","ERP-31325","ERP-32926","ERP-31873","ERP-32959"];
        const placeholders = ids.map(() => "?").join(",");
        const [rows, doneRow, errorRow] = await Promise.all([
          database.prepare(`SELECT id,name,photo,sort_order FROM products WHERE id IN (${placeholders}) ORDER BY sort_order,name`).bind(...ids).all(),
          database.prepare("SELECT value FROM app_settings WHERE key='admin_page15_photo_corrections_v1'").first<{ value: string }>(),
          database.prepare("SELECT value FROM app_settings WHERE key='admin_page15_photo_corrections_v1_error'").first<{ value: string }>(),
        ]);
        return Response.json({
          page15CorrectionStatus: true,
          done: doneRow?.value === "1",
          error: errorRow?.value || "",
          products: rows.results,
        }, { headers: { "Cache-Control": "no-store" } });
      }

      if (url.searchParams.get("photoReviewPage") === "1") {
        if (url.searchParams.get("token") !== PHOTO_AUTOFILL_TOKEN) {
          return Response.json({ error: "forbidden" }, { status: 403 });
        }
        const database = db();
        const page = Math.max(1, Math.floor(Number(url.searchParams.get("page") || "1")));
        const pageSize = Math.max(1, Math.min(100, Math.floor(Number(url.searchParams.get("pageSize") || "20"))));
        const offset = (page - 1) * pageSize;
        const [countRow, rows] = await Promise.all([
          database.prepare("SELECT COUNT(*) AS count FROM products").first<{ count: number }>(),
          database
            .prepare("SELECT id,name,category,sub,unit,photo,sort_order,hidden,soldout FROM products ORDER BY sort_order,name LIMIT ? OFFSET ?")
            .bind(pageSize, offset)
            .all(),
        ]);
        const total = Number(countRow?.count ?? 0);
        return Response.json({
          photoReviewPage: true,
          page,
          pageSize,
          total,
          pages: Math.max(1, Math.ceil(total / pageSize)),
          startIndex: offset + 1,
          endIndex: Math.min(total, offset + pageSize),
          products: rows.results,
        }, { headers: { "Cache-Control": "no-store" } });
      }

      if (url.searchParams.get("photoMap") === "1") {
        if (url.searchParams.get("token") !== PHOTO_AUTOFILL_TOKEN) {
          return Response.json({ error: "forbidden" }, { status: 403 });
        }
        const database = db();
        const manifest = await readPhotoManifest();
        const targetIds = new Set(manifest.flatMap((entry) => entry.productIds));
        const rows = await database
          .prepare("SELECT id,name,photo FROM products WHERE id LIKE 'ERP-%' ORDER BY id")
          .all();
        const mappings = (rows.results as Array<Record<string, unknown>>)
          .filter((row) => targetIds.has(String(row.id)))
          .map((row) => ({
            id: String(row.id),
            name: String(row.name ?? ""),
            photo: String(row.photo ?? ""),
          }));
        return Response.json({ count: mappings.length, mappings }, { headers: { "Cache-Control": "no-store" } });
      }

      if (url.searchParams.get("photoBlankList") === "1") {
        if (url.searchParams.get("token") !== PHOTO_AUTOFILL_TOKEN) {
          return Response.json({ error: "forbidden" }, { status: 403 });
        }
        const database = db();
        const manifest = await readPhotoManifest();
        const targetIds = new Set(manifest.flatMap((entry) => entry.productIds));
        const rows = await database
          .prepare("SELECT id,name,category,sub,unit,photo FROM products WHERE id LIKE 'ERP-%' ORDER BY sort_order,name")
          .all();
        const products = (rows.results as Array<Record<string, unknown>>)
          .filter((row) => targetIds.has(String(row.id)))
          .filter((row) => !String(row.photo ?? "").trim())
          .map((row) => ({
            id: String(row.id),
            name: String(row.name ?? ""),
            category: String(row.category ?? ""),
            sub: String(row.sub ?? ""),
            unit: String(row.unit ?? ""),
          }));
        return Response.json({ count: products.length, products }, { headers: { "Cache-Control": "no-store" } });
      }

      if (url.searchParams.get("photoApply") === "1") {
        if (url.searchParams.get("token") !== PHOTO_AUTOFILL_TOKEN) {
          return Response.json({ error: "forbidden" }, { status: 403 });
        }
        const id = (url.searchParams.get("id") || "").trim();
        const sourceUrl = (url.searchParams.get("source") || "").trim();
        if (!/^ERP-[A-Za-z0-9-]+$/.test(id) || !/^https?:\/\//i.test(sourceUrl)) {
          return Response.json({ error: "invalid input" }, { status: 400 });
        }

        const manifest = await readPhotoManifest();
        const targetIds = new Set(manifest.flatMap((entry) => entry.productIds));
        if (!targetIds.has(id)) return Response.json({ error: "not a photo target" }, { status: 400 });

        const database = db();
        const product = await database
          .prepare("SELECT id,name,photo FROM products WHERE id=?")
          .bind(id)
          .first<{ id: string; name: string; photo: string }>();
        if (!product) return Response.json({ error: "product not found" }, { status: 404 });
        if ((product.photo || "").trim()) {
          return Response.json({ ok: true, skipped: true, reason: "already has photo", photo: product.photo });
        }

        const key = `catalog-search-${id.toLowerCase().replace(/[^a-z0-9-]/g, "")}.webp`;
        const result = await importPhotoEntry({ key, sourceUrl, productIds: [id] });
        return Response.json({
          ok: true,
          id,
          name: product.name,
          photo: `/api/photo?id=${key}`,
          ...result,
        }, { headers: { "Cache-Control": "no-store" } });
      }

      if (url.searchParams.get("photoAutoFill") === "1") {
        if (url.searchParams.get("token") !== PHOTO_AUTOFILL_TOKEN) {
          return Response.json({ error: "forbidden" }, { status: 403 });
        }
        const limit = Number(url.searchParams.get("limit") || "8");
        return Response.json(await runCatalogPhotoAutoFill(limit), { headers: { "Cache-Control": "no-store" } });
      }
      if (url.searchParams.get("photoAutoStatus") === "1") {
        if (url.searchParams.get("token") !== PHOTO_AUTOFILL_TOKEN) {
          return Response.json({ error: "forbidden" }, { status: 403 });
        }
        return Response.json(await catalogPhotoAutoFillStatus(), { headers: { "Cache-Control": "no-store" } });
      }

      if (url.searchParams.get("photoSearchTest") === "1") {
        const query = (url.searchParams.get("q") || "갈비맛치킨꼬치 업소용 대용량 식자재").slice(0, 120);
        return Response.json(await searchCatalogImageCandidates(query), { headers: { "Cache-Control": "no-store" } });
      }

      if (url.searchParams.get("photoImport") === "1") {
        const retryOnly = url.searchParams.get("retry") === "1";
        return Response.json(await runPhotoImport(retryOnly), { headers: { "Cache-Control": "no-store" } });
      }
      if (url.searchParams.get("photoStatus") === "1") {
        return Response.json(await photoImportStatus(), { headers: { "Cache-Control": "no-store" } });
      }

      if (url.searchParams.get("health") === "1") {
        const database = db();
        const [total, erp, options, marker, importError] = await Promise.all([
          database.prepare("SELECT COUNT(*) AS count FROM products").first<{ count: number }>(),
          database.prepare("SELECT COUNT(*) AS count FROM products WHERE id LIKE 'ERP-%'").first<{ count: number }>(),
          database.prepare("SELECT COUNT(*) AS count FROM pack_options").first<{ count: number }>(),
          database.prepare("SELECT value FROM app_settings WHERE key='excel_catalog_import_v3'").first<{ value: string }>(),
          database.prepare("SELECT value FROM app_settings WHERE key='excel_catalog_import_error'").first<{ value: string }>(),
        ]);
        return Response.json({
          totalProducts: Number(total?.count ?? 0),
          erpProducts: Number(erp?.count ?? 0),
          packOptions: Number(options?.count ?? 0),
          imported: marker?.value === "1",
          error: importError?.value ?? "",
        }, { headers: { "Cache-Control": "no-store" } });
      }

      const customer = await getCustomer(request);
      // 관리자 화면은 ?all=1 로 숨김 상품까지 받아감 (관리자 인증 필수)
      const wantsAll = url.searchParams.get("all") === "1";
      const includeHidden = wantsAll && await isAdmin(request);
      const store = await readStore(customer?.priceGroup, { includeHidden });
      return Response.json(store, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      console.error(error);
      return Response.json({ error: "상품을 불러오지 못했습니다." }, { status: 500 });
    }
  } } },
});
